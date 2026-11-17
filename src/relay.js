import { hash, idPattern, matches, maxEnvelopeBytes, messageIdPattern, retentionMs } from './protocol.js'
import { openDatabase, transaction } from './storage.js'

const pageSize = 16
const mailboxCapacity = 256
const relayCapacity = 4096
const mailboxLimit = 64
const json = Response.json.bind(Response)

async function readBody(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Missing body')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxEnvelopeBytes) throw new Error('Body too large')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel()
  }
}

export function openRelay(directory, { now = Date.now } = {}) {
  const db = openDatabase(directory, 'relay.sqlite')
  db.exec(`
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS mailboxes (id TEXT PRIMARY KEY, write_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (
      mailbox TEXT NOT NULL, id TEXT NOT NULL, expires INTEGER NOT NULL,
      digest TEXT NOT NULL, sealed TEXT,
      PRIMARY KEY (mailbox, id)
    );
    CREATE INDEX IF NOT EXISTS deliveries_expiration ON deliveries (expires);
  `)
  const mailbox = db.prepare('SELECT write_hash FROM mailboxes WHERE id = ?')
  const prune = db.prepare('DELETE FROM deliveries WHERE expires <= ?')

  function register(id, writeHash) {
    return transaction(db, () => {
      const existing = mailbox.get(id)
      if (existing) return existing.write_hash === writeHash ? 200 : 409
      if (db.prepare('SELECT count(*) AS n FROM mailboxes').get().n >= mailboxLimit) return 507
      db.prepare('INSERT INTO mailboxes VALUES (?, ?)').run(id, writeHash)
      return 201
    })
  }

  function enqueue(recipient, id, expires, sealed, current) {
    return transaction(db, () => {
      prune.run(current)
      const digest = hash(sealed)
      const existing = db.prepare('SELECT digest, expires FROM deliveries WHERE mailbox = ? AND id = ?')
        .get(recipient, id)
      if (existing) return existing.digest === digest && existing.expires === expires ? 200 : 409
      if (db.prepare('SELECT count(*) AS n FROM deliveries WHERE mailbox = ?').get(recipient).n >= mailboxCapacity ||
          db.prepare('SELECT count(*) AS n FROM deliveries').get().n >= relayCapacity) return 507
      db.prepare('INSERT INTO deliveries VALUES (?, ?, ?, ?, ?)').run(recipient, id, expires, digest, sealed)
      return 201
    })
  }

  async function handle(request) {
    const { pathname } = new URL(request.url)
    const [, version, resource, recipient, id, extra] = pathname.split('/')
    if (version !== 'v1' || resource !== 'mailboxes' || !idPattern.test(recipient) ||
        (id !== undefined && !messageIdPattern.test(id)) || extra !== undefined) {
      return json({ error: 'Unknown route' }, { status: 404 })
    }
    const auth = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)
    if (!auth) return json({ error: 'Authentication required' }, { status: 401 })
    const tokenHash = hash(auth[1])
    const reading = tokenHash === recipient
    const current = now()

    if (request.method === 'GET' && id === undefined && reading) {
      prune.run(current)
      const records = db.prepare(`
        SELECT id, expires, sealed FROM deliveries WHERE mailbox = ? AND sealed IS NOT NULL ORDER BY rowid LIMIT ?
      `).all(recipient, pageSize)
      return json(records, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (request.method === 'DELETE' && id !== undefined && reading) {
      db.prepare('UPDATE deliveries SET sealed = NULL WHERE mailbox = ? AND id = ?').run(recipient, id)
      return new Response(null, { status: 204 })
    }

    const registering = request.method === 'PUT' && id === undefined && reading
    const sending = request.method === 'PUT' && id !== undefined && tokenHash === mailbox.get(recipient)?.write_hash
    if (!registering && !sending) return json({ error: 'Forbidden' }, { status: 403 })
    let body
    try {
      body = await readBody(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body')
    } catch {
      return json({ error: 'Invalid request body' }, { status: 400 })
    }
    if (registering) {
      if (!matches(idPattern, body.writeHash)) return json({ error: 'Invalid write capability' }, { status: 400 })
      return json({}, { status: register(recipient, body.writeHash) })
    }
    if (!Number.isSafeInteger(body.expires) || body.expires <= current ||
        body.expires > current + retentionMs + 60_000 || typeof body.sealed !== 'string' ||
        !/^[\w-]+\.[\w-]*\.[\w-]+\.[\w-]+\.[\w-]+$/.test(body.sealed)) {
      return json({ error: 'Invalid or expired envelope' }, { status: 400 })
    }
    return json({}, { status: enqueue(recipient, id, body.expires, body.sealed, current) })
  }

  prune.run(now())
  const cleanup = setInterval(() => prune.run(now()), 60_000)
  cleanup.unref()
  return {
    handle,
    close() {
      clearInterval(cleanup)
      db.close()
    }
  }
}
