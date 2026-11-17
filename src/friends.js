import { encodeInvitation, fingerprint, matches, messageIdPattern, newPayload, readInvitation, seal } from './protocol.js'
import { transaction } from './storage.js'

const aliasPattern = /^[\p{L}\p{N}_.-]{1,32}$/u

export function friendRequests(db, { identity, self, now, queue }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT NOT NULL, direction TEXT NOT NULL, mailbox TEXT NOT NULL, alias TEXT,
      profile TEXT NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL, response_id TEXT,
      PRIMARY KEY (id, direction)
    );
    CREATE INDEX IF NOT EXISTS friend_requests_mailbox ON friend_requests (mailbox, direction, status, expires);
  `)
  const insert = db.prepare(`INSERT OR IGNORE INTO friend_requests
    (id, direction, mailbox, alias, profile, expires, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const rowById = db.prepare('SELECT * FROM friend_requests WHERE id = ? AND direction = ?')
  const contactByMailbox = db.prepare('SELECT alias, profile FROM contacts WHERE mailbox = ?')
  const contactByAlias = db.prepare('SELECT mailbox FROM contacts WHERE alias = ?')
  const activeOutgoing = db.prepare(`
    SELECT * FROM friend_requests WHERE mailbox = ? AND direction = 'out' AND status = 'pending' AND expires > ?
    ORDER BY rowid DESC LIMIT 1
  `)
  const update = db.prepare('UPDATE friend_requests SET status = ?, alias = ?, response_id = ? WHERE id = ? AND direction = ?')

  function verifiedProfile(mailbox) {
    const contact = contactByMailbox.get(mailbox)
    if (contact) return JSON.parse(contact.profile)
    const request = db.prepare(`
      SELECT profile FROM friend_requests WHERE mailbox = ? AND direction = 'out' ORDER BY rowid DESC LIMIT 1
    `).get(mailbox)
    return request && JSON.parse(request.profile)
  }

  function aliasTaken(alias, mailbox) {
    const existing = contactByAlias.get(alias)
    const reserved = db.prepare(`
      SELECT 1 FROM friend_requests WHERE alias = ? AND mailbox <> ? AND direction = 'out'
      AND status = 'pending' AND expires > ?
    `).get(alias, mailbox, now())
    return (existing && existing.mailbox !== mailbox) || !!reserved
  }

  function checkAlias(alias, mailbox) {
    if (!matches(aliasPattern, alias)) throw new Error('联系人名称须为 1 至 32 个字母、数字或常用连接符')
    if (aliasTaken(alias, mailbox)) throw new Error('该联系人名称已被使用')
  }

  function ensureSameProfile(previous, profile) {
    if (previous && fingerprint(previous) !== fingerprint(profile)) throw new Error('对方设备指纹已变更')
  }

  function pair(alias, profile, strict = false) {
    const existing = contactByMailbox.get(profile.mailbox)
    if (existing) {
      ensureSameProfile(JSON.parse(existing.profile), profile)
      if (strict && existing.alias !== alias) throw new Error('该设备已有联系人名称')
      return existing.alias
    }
    checkAlias(alias, profile.mailbox)
    db.prepare('INSERT INTO contacts VALUES (?, ?, ?)').run(alias, profile.mailbox, JSON.stringify(profile))
    return alias
  }

  async function verifyInvite(code, confirmedFingerprint) {
    const profile = await readInvitation(code)
    if (profile.mailbox === self.mailbox) throw new Error('请选择对方的邀请')
    if (fingerprint(profile) !== confirmedFingerprint) throw new Error('Contact fingerprint differs')
    return profile
  }

  async function prepare(recipient, content) {
    const message = newPayload(identity, recipient, now(), content)
    return { message, sealed: await seal(identity, recipient, message) }
  }

  return {
    signer(mailbox, message) {
      if (message.type === 'friend-request') return verifiedProfile(mailbox)
      if (message.type !== 'friend-response' || !matches(messageIdPattern, message.requestId)) return undefined
      const request = rowById.get(message.requestId, 'out')
      return request?.mailbox === mailbox ? JSON.parse(request.profile) : undefined
    },
    async trust(alias, code, confirmedFingerprint) {
      if (!matches(aliasPattern, alias)) throw new Error('Invalid contact name')
      const profile = await verifyInvite(code, confirmedFingerprint)
      transaction(db, () => {
        // Existing CLI users can still import a verified contact directly.
        ensureSameProfile(verifiedProfile(profile.mailbox), profile)
        pair(alias, profile, true)
      })
    },
    async request(alias, code, confirmedFingerprint) {
      const profile = await verifyInvite(code, confirmedFingerprint)
      const { message, sealed } = await prepare(profile, { type: 'friend-request', invite: encodeInvitation(self) })
      return transaction(db, () => {
        ensureSameProfile(verifiedProfile(profile.mailbox), profile)
        if (contactByMailbox.get(profile.mailbox)) return { status: 'already-friend' }
        checkAlias(alias, profile.mailbox)
        const existing = activeOutgoing.get(profile.mailbox, now())
        if (existing) return { id: existing.id, status: 'pending' }
        insert.run(message.id, 'out', profile.mailbox, alias, JSON.stringify(profile), message.expires, 'pending')
        queue(message, sealed, profile.writeToken)
        return { id: message.id, status: 'pending' }
      })
    },
    async decide(id, decision, alias, confirmedFingerprint) {
      if (!matches(messageIdPattern, id) || !['accepted', 'rejected'].includes(decision)) throw new Error('好友操作无效')
      const pending = rowById.get(id, 'in')
      if (!pending) throw new Error('好友申请不存在')
      const profile = JSON.parse(pending.profile)
      if (decision === 'accepted' && fingerprint(profile) !== confirmedFingerprint) throw new Error('请先核对对方设备指纹')
      const { message, sealed } = await prepare(profile, { type: 'friend-response', requestId: id, decision })
      return transaction(db, () => {
        const request = rowById.get(id, 'in')
        if (request.status === decision) return { status: decision, deliveryId: request.response_id }
        if (request.status !== 'pending' || request.expires <= now()) throw new Error('好友申请已处理或过期')
        if (decision === 'accepted') ensureSameProfile(verifiedProfile(profile.mailbox), profile)
        const contact = decision === 'accepted' ? pair(alias, profile) : null
        update.run(decision, contact, message.id, id, 'in')
        queue(message, sealed, profile.writeToken)
        return { status: decision, deliveryId: message.id }
      })
    },
    receive(message) {
      return transaction(db, () => {
        if (message.type === 'friend-request') {
          const profile = message.applicant
          const established = contactByMailbox.get(message.from)
          return insert.run(message.id, 'in', message.from, established?.alias ?? null,
            JSON.stringify(profile), message.expires, 'pending').changes
        }
        const request = rowById.get(message.requestId, 'out')
        if (request?.status !== 'pending' || request.mailbox !== message.from) return 0
        const profile = JSON.parse(request.profile)
        let alias = request.alias
        if (message.decision === 'accepted') {
          for (let index = 1; aliasTaken(alias, profile.mailbox); index++) {
            alias = `好友-${profile.mailbox.slice(0, 12)}-${index}`
          }
          alias = pair(alias, profile)
        }
        return update.run(message.decision, alias, null, request.id, 'out').changes
      })
    },
    list() {
      const time = now()
      const rows = db.prepare(`
        SELECT id, direction, alias, profile, expires, status FROM friend_requests
        ORDER BY direction = 'in' AND status = 'pending' AND expires > ? DESC, rowid DESC LIMIT 40
      `).all(time)
      return rows.map(({ id, direction, alias, profile, status, expires }) => ({
        id, direction, alias, expires, fingerprint: fingerprint(JSON.parse(profile)),
        status: status === 'pending' && expires <= time ? 'expired' : status
      }))
    },
    pendingCount() {
      return db.prepare(`SELECT count(*) AS n FROM friend_requests
        WHERE direction = 'in' AND status = 'pending' AND expires > ?`).get(now()).n
    }
  }
}
