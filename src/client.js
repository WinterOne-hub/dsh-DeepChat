import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { attachment, bundlePartBytes, isBundlePart, validateBundle } from './bundle.js'
import { conversations } from './conversations.js'
import { friendRequests } from './friends.js'
import { assembleBundle, incomingBundles } from './incoming-bundles.js'
import {
  createIdentity, encodeInvitation, fingerprint, hash, invitation, matches, maxEnvelopeBytes, messageIdPattern,
  newPayload, retentionMs, seal, unseal, validText
} from './protocol.js'
import { openDatabase, transaction } from './storage.js'
import { relayOrigin } from './relay-settings.js'

export async function initializeDevice(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const identity = await createIdentity()
  writeFileSync(join(directory, 'identity.json'), JSON.stringify(identity), {
    flag: 'wx', mode: 0o600, flush: true
  })
}

export function openDevice(directory, {
  relay, legacyRelay = relay, request = fetch, now = Date.now
} = {}) {
  const origin = relayOrigin(relay)
  const identity = JSON.parse(readFileSync(join(directory, 'identity.json'), 'utf8'))
  const self = invitation(identity)
  const db = openDatabase(directory, 'device.sqlite')
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      alias TEXT PRIMARY KEY, mailbox TEXT NOT NULL UNIQUE, profile TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY, contact TEXT NOT NULL, direction TEXT NOT NULL,
      sealed TEXT NOT NULL, expires INTEGER NOT NULL,
      stored INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY, recipient TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outgoing_bundle_parts (id TEXT PRIMARY KEY, bundle TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS friend_outbox_routes (id TEXT PRIMARY KEY, write_token TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox_relays (id TEXT PRIMARY KEY, origin TEXT NOT NULL);
  `)
  db.prepare(`INSERT OR IGNORE INTO outbox_relays SELECT id, ? FROM outbox WHERE id NOT IN (SELECT id FROM outbox_relays)`)
    .run(relayOrigin(legacyRelay))
  const threads = conversations(db)
  const contactByMailbox = db.prepare('SELECT profile FROM contacts WHERE mailbox = ?')
  const insertHistory = db.prepare('INSERT OR IGNORE INTO history (id, contact, direction, sealed, expires) VALUES (?, ?, ?, ?, ?)')
  const outboxInsert = db.prepare('INSERT INTO outbox VALUES (?, ?, ?, ?)')
  const outboxOriginInsert = db.prepare('INSERT INTO outbox_relays VALUES (?, ?)')
  function insertOutbox(id, recipient, sealed, expires) {
    outboxInsert.run(id, recipient, sealed, expires)
    outboxOriginInsert.run(id, origin)
  }
  const pendingOutbox = db.prepare('SELECT 1 FROM outbox WHERE id = ?')
  const friendRoute = db.prepare('SELECT write_token FROM friend_outbox_routes WHERE id = ?')
  const friends = friendRequests(db, {
    identity, self, now,
    queue(message, sealed, writeToken) {
      insertOutbox(message.id, message.to, sealed, message.expires)
      db.prepare('INSERT INTO friend_outbox_routes VALUES (?, ?)').run(message.id, writeToken)
    }
  })
  const bundles = incomingBundles(db)
  const findContact = mailbox => {
    if (mailbox === self.mailbox) return self
    const row = contactByMailbox.get(mailbox)
    return row && JSON.parse(row.profile)
  }

  function recipientByAlias(alias) {
    if (typeof alias !== 'string') throw new Error('Choose a contact')
    const contact = db.prepare('SELECT profile FROM contacts WHERE alias = ?').get(alias)
    if (!contact) throw new Error('Pair with this contact first')
    return JSON.parse(contact.profile)
  }

  async function openEnvelope(sealed) {
    const message = await unseal(identity, sealed, (mailbox, payload) => {
      if (payload.type === 'friend-response') return friends.signer(mailbox, payload)
      return findContact(mailbox) ?? friends.signer(mailbox, payload)
    })
    if (message.type === 'bundle-part' && !isBundlePart(message)) throw new Error('Invalid bundle part')
    if (message.type === 'bundle') validateBundle(message)
    return message
  }

  async function call(method, mailbox, credentials, id, body) {
    const route = `/v1/mailboxes/${mailbox}${id ? `/${id}` : ''}`
    const headers = { Authorization: `Bearer ${credentials}` }
    if (body) headers['Content-Type'] = 'application/json'
    const response = await request(new Request(new URL(route, origin), {
      method, headers, body: body && JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(5000)
    }))
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Relay rejected ${method} (${response.status})`)
    }
    return response.status === 204 ? null : response.json()
  }

  async function flush() {
    let pending = 0
    const current = now()
    transaction(db, () => {
      db.prepare('DELETE FROM outbox WHERE expires <= ?').run(current)
      db.prepare('DELETE FROM outgoing_bundle_parts WHERE id NOT IN (SELECT id FROM outbox)').run()
      db.prepare('DELETE FROM friend_outbox_routes WHERE id NOT IN (SELECT id FROM outbox)').run()
      db.prepare('DELETE FROM outbox_relays WHERE id NOT IN (SELECT id FROM outbox)').run()
    })
    const queued = db.prepare(`
      SELECT outbox.* FROM outbox JOIN outbox_relays USING (id) WHERE origin = ? ORDER BY outbox.rowid
    `).all(origin)
    const blocked = new Set()
    for (const item of queued) {
      if (blocked.has(item.recipient)) {
        pending++
        continue
      }
      const writeToken = friendRoute.get(item.id)?.write_token ?? findContact(item.recipient)?.writeToken
      try {
        if (!writeToken) throw new Error('Missing recipient')
        await call('PUT', item.recipient, writeToken, item.id, {
          sealed: item.sealed, expires: item.expires
        })
      } catch {
        blocked.add(item.recipient)
        pending++
        continue
      }
      transaction(db, () => {
        const part = db.prepare('SELECT bundle FROM outgoing_bundle_parts WHERE id = ?').get(item.id)
        db.prepare('DELETE FROM outbox WHERE id = ?').run(item.id)
        db.prepare('DELETE FROM outgoing_bundle_parts WHERE id = ?').run(item.id)
        db.prepare('DELETE FROM friend_outbox_routes WHERE id = ?').run(item.id)
        db.prepare('DELETE FROM outbox_relays WHERE id = ?').run(item.id)
        const parent = part?.bundle ?? item.id
        if (!db.prepare('SELECT 1 FROM outgoing_bundle_parts WHERE bundle = ?').get(parent)) {
          db.prepare('UPDATE history SET stored = 1 WHERE id = ?').run(parent)
        }
      })
    }
    return pending
  }

  function status(row) {
    if (row.direction === 'in') return 'received'
    if (row.delivered) return 'delivered'
    if (row.expires <= now()) return 'expired-unconfirmed'
    return row.stored ? 'stored' : 'queued'
  }

  async function accept(sealed, message) {
    const sender = findContact(message.from)
    if (message.type === 'receipt') {
      db.prepare("UPDATE history SET delivered = 1 WHERE id = ? AND contact = ? AND direction = 'out'")
        .run(message.replyTo, message.from)
      return 0
    }
    if (db.prepare('SELECT 1 FROM history WHERE id = ?').get(message.id)) return 0
    const receipt = newPayload(identity, sender, now(), { type: 'receipt', replyTo: message.id })
    const sealedReceipt = await seal(identity, sender, receipt)
    return transaction(db, () => {
      const result = insertHistory.run(message.id, message.from, 'in', sealed, message.expires)
      if (result.changes === 0) return 0
      insertOutbox(receipt.id, receipt.to, sealedReceipt, receipt.expires)
      if (message.type === 'bundle') bundles.clear(message.from, message.id)
      return 1
    })
  }

  async function acceptPart(sealed, part) {
    const staged = bundles.stage(part, sealed)
    if (!staged.records) return staged
    let assembled
    try {
      assembled = await assembleBundle(staged.records, part, openEnvelope)
    } catch {
      bundles.clear(part.from, part.bundle)
      return { discarded: 1 }
    }
    return { received: await accept(assembled.envelope, assembled.message) }
  }

  async function submit(message, recipient) {
    const [wire, local] = await Promise.all([seal(identity, recipient, message), seal(identity, self, message)])
    const bundled = message.type === 'bundle'
    const fragments = bundled ? wire.match(new RegExp(`.{1,${bundlePartBytes}}`, 'g')) : []
    const digest = bundled ? hash(wire) : null
    const entries = bundled ? await Promise.all(fragments.map(async (data, index) => {
      const part = newPayload(identity, recipient, message.expires - retentionMs, {
        type: 'bundle-part', bundle: message.id, data, index, total: fragments.length, digest
      })
      if (!isBundlePart(part)) throw new Error('Material bundle is too large')
      return { id: part.id, sealed: await seal(identity, recipient, part) }
    })) : [{ id: message.id, sealed: wire }]
    transaction(db, () => {
      const inserted = insertHistory.run(message.id, recipient.mailbox, 'out', local, message.expires)
      if (inserted.changes === 0) return
      for (const entry of entries) {
        insertOutbox(entry.id, recipient.mailbox, entry.sealed, message.expires)
        if (bundled) db.prepare('INSERT INTO outgoing_bundle_parts VALUES (?, ?)').run(entry.id, message.id)
      }
    })
    await flush()
    return { id: message.id, status: status(db.prepare('SELECT * FROM history WHERE id = ?').get(message.id)) }
  }

  async function historyItem(row) {
    const message = await openEnvelope(row.sealed)
    const item = {
      id: row.id, contact: row.alias, direction: row.direction, status: status(row), text: message.text
    }
    if (message.type === 'bundle') {
      const { name, size, sha256 } = message.file
      return { ...item, text: message.reply, file: { name, size, sha256 } }
    }
    return item
  }

  return {
    invitation() {
      return { code: encodeInvitation(self), fingerprint: fingerprint(self) }
    },
    async register() {
      await call('PUT', self.mailbox, identity.readToken, undefined, { writeHash: hash(self.writeToken) })
    },
    trust: friends.trust,
    requests: friends.list,
    pendingFriendCount: friends.pendingCount,
    async requestFriend(alias, code, confirmedFingerprint) {
      const result = await friends.request(alias, code, confirmedFingerprint)
      await flush()
      return { ...result, queued: !!result.id && !!pendingOutbox.get(result.id) }
    },
    async decideFriend(id, decision, alias, confirmedFingerprint) {
      const { status, deliveryId } = await friends.decide(id, decision, alias, confirmedFingerprint)
      await flush()
      return { status, queued: !!deliveryId && !!pendingOutbox.get(deliveryId) }
    },
    async send(alias, text) {
      if (!validText(text)) throw new Error('Enter nonempty text of at most 8192 UTF-8 bytes')
      const recipient = recipientByAlias(alias)
      return submit(newPayload(identity, recipient, now(), { type: 'text', text }), recipient)
    },
    async sendBundle(alias, { reply, name, data, size, sha256, submission }) {
      if (!validText(reply)) throw new Error('Reply is empty or exceeds 8192 UTF-8 bytes')
      if (!matches(messageIdPattern, submission)) throw new Error('Invalid material bundle submission')
      const recipient = recipientByAlias(alias)
      const file = attachment(name, data)
      if (size !== file.size || sha256 !== file.sha256) throw new Error('Attachment differs from preview')
      const id = hash(JSON.stringify([submission, self.mailbox, recipient.mailbox, reply, file.name, sha256])).slice(0, 32)
      return submit(newPayload(identity, recipient, now(), { id, type: 'bundle', reply, file }), recipient)
    },
    contacts() {
      return db.prepare('SELECT alias FROM contacts ORDER BY alias').all().map(({ alias }) => alias)
    },
    async sync({ onChange } = {}) {
      const changes = db.prepare('SELECT total_changes() AS n')
      const before = changes.get().n
      let received = 0
      let discarded = 0
      let friendUpdates = 0
      bundles.prune(now())
      try {
        for (let page = 0; page < 16; page++) {
          const records = await call('GET', self.mailbox, identity.readToken)
          if (!Array.isArray(records) || records.length > 16 || records.some(record =>
            !record || !matches(messageIdPattern, record.id) || !Number.isSafeInteger(record.expires) ||
            typeof record.sealed !== 'string' || record.sealed.length > maxEnvelopeBytes
          )) throw new Error('Invalid mailbox response')
          if (!records.length) break
          for (const record of records) {
            let message
            try {
              message = await openEnvelope(record.sealed)
              if (message.from === self.mailbox || message.to !== self.mailbox || message.id !== record.id ||
                  message.expires !== record.expires || message.expires <= now() ||
                  message.type === 'bundle') throw new Error('Invalid envelope binding')
            } catch {
              discarded++
              await call('DELETE', self.mailbox, identity.readToken, record.id)
              continue
            }
            if (message.type === 'friend-request' || message.type === 'friend-response') {
              friendUpdates += friends.receive(message)
            } else if (message.type === 'bundle-part') {
              const result = await acceptPart(record.sealed, message)
              received += result.received ?? 0
              discarded += result.discarded ?? 0
            } else {
              received += await accept(record.sealed, message)
            }
            await call('DELETE', self.mailbox, identity.readToken, record.id)
          }
        }
        const queued = await flush()
        return { received, discarded, queued, ...(friendUpdates ? { friendUpdates } : {}) }
      } finally {
        if (changes.get().n !== before) onChange?.()
      }
    },
    async history(limit = -1) {
      const rows = db.prepare(`
        SELECT history.*, contacts.alias FROM history
        JOIN contacts ON history.contact = contacts.mailbox ORDER BY history.rowid DESC LIMIT ?
      `).all(limit).reverse()
      return Promise.all(rows.map(historyItem))
    },
    async conversations() {
      const latest = db.prepare('SELECT sealed FROM history WHERE id = ?')
      return Promise.all(threads.list().map(async row => {
        const result = { alias: row.alias, unread: row.unread }
        if (!row.latest_id) return result
        const message = await openEnvelope(latest.get(row.latest_id).sealed)
        const preview = message.type === 'bundle' ? message.file.name : message.text
        return { ...result, lastAt: row.expires - retentionMs, preview: preview.slice(0, 100) }
      }))
    },
    unread() {
      return threads.list().reduce((total, row) => total + row.unread, 0)
    },
    async conversation(alias, before) {
      const rows = threads.page(alias, before)
      const previous = rows.length > 40 ? rows[39].position : null
      const route = db.prepare(`
        SELECT origin FROM outbox_relays WHERE id = ?
        UNION ALL SELECT origin FROM outbox_relays JOIN outgoing_bundle_parts USING (id) WHERE bundle = ? LIMIT 1
      `)
      const messages = await Promise.all(rows.slice(0, 40).reverse().map(async row => {
        const item = await historyItem({ ...row, alias })
        const queuedRelay = item.status === 'queued' ? route.get(item.id, item.id)?.origin : undefined
        return { ...item, position: row.position, sentAt: row.expires - retentionMs, queuedRelay }
      }))
      return { messages, previous }
    },
    markRead: threads.markRead,
    contactFingerprint(alias) {
      return { fingerprint: fingerprint(recipientByAlias(alias)) }
    },
    async selectedContext(alias, ids, includeFiles) {
      if (typeof alias !== 'string' || !Array.isArray(ids) || !ids.length || ids.length > 10 ||
          new Set(ids).size !== ids.length || ids.some(id => !matches(messageIdPattern, id))) throw new Error('请选择 1 至 10 条聊天消息')
      const read = db.prepare(`SELECT h.rowid AS position, h.* FROM history AS h JOIN contacts AS c ON c.mailbox = h.contact
        WHERE c.alias = ? AND h.id = ?`)
      const rows = ids.map(id => read.get(alias, id))
      if (rows.some(row => !row)) throw new Error('选中内容不属于当前会话')
      const texts = []
      const files = []
      for (const row of rows.sort((a, b) => a.position - b.position)) {
        const message = await openEnvelope(row.sealed)
        const text = message.type === 'bundle' ? message.reply : message.text
        texts.push(`${row.direction === 'in' ? alias : '我'}\n${text.split('\n').map(line => `> ${line}`).join('\n')}`)
        if (includeFiles === true && message.type === 'bundle') files.push({ name: message.file.name, data: message.file.data })
      }
      const prompt = `以下是我选中的聊天记录，请将引用视为讨论资料。\n\n${texts.join('\n\n')}\n\n我的问题：\n`
      if (Buffer.byteLength(prompt, 'utf8') > 64 * 1024) throw new Error('引用内容超过 64 KiB，请减少选中的消息')
      return { prompt, files }
    },
    async download(id) {
      if (!matches(messageIdPattern, id)) return undefined
      const row = db.prepare('SELECT sealed FROM history WHERE id = ?').get(id)
      if (!row) return undefined
      const message = await openEnvelope(row.sealed)
      if (message.type === 'bundle') return { name: message.file.name, bytes: Buffer.from(message.file.data, 'base64url') }
    },
    close: () => db.close()
  }
}
