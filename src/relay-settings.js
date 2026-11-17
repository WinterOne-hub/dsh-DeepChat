import { openDatabase, transaction } from './storage.js'

export const defaultRelay = 'http://127.0.0.1:8611'
const timeout = () => AbortSignal.timeout(5000)

export function relayOrigin(value = defaultRelay) {
  let url
  try {
    if (typeof value !== 'string') throw new Error()
    url = new URL(value.trim())
  } catch {
    throw new Error('请输入有效的投递服务地址')
  }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请使用 HTTPS 服务地址或本机 127.0.0.1 的 HTTP 地址')
  }
  return url.origin
}

export async function testRelay(origin, request = fetch) {
  // Older relay builds respond on the mailbox route. The probe uses no device address or credentials.
  const path = `/v1/mailboxes/${'0'.repeat(64)}`
  try {
    const response = await request(new Request(new URL(path, origin), { redirect: 'error', signal: timeout() }))
    const reader = response.body?.getReader()
    if (!reader) throw new Error()
    try {
      if (response.status !== 401) throw new Error()
      let bytes = 0
      const chunks = []
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > 1024) throw new Error()
        chunks.push(value)
      }
      if (JSON.parse(Buffer.concat(chunks).toString('utf8')).error !== 'Authentication required') throw new Error()
    } finally {
      await reader.cancel()
    }
  } catch {
    throw new Error('无法连接投递服务，请检查地址和服务状态')
  }
}

export function relaySettings(directory, fallback) {
  function withSettings(work) {
    const db = openDatabase(directory, 'relay-settings.sqlite')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS active_relay (id INTEGER PRIMARY KEY CHECK (id = 1), origin TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS registered_relays (origin TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS local_relay (id INTEGER PRIMARY KEY CHECK (id = 1));
      `)
      return work(db)
    } finally {
      db.close()
    }
  }

  return {
    localEnabled() {
      return withSettings(db => !!db.prepare('SELECT 1 FROM local_relay WHERE id = 1').get())
    },
    enableLocal() {
      withSettings(db => db.prepare('INSERT OR IGNORE INTO local_relay VALUES (1)').run())
    },
    disableLocal() {
      withSettings(db => db.prepare('DELETE FROM local_relay').run())
    },
    get() {
      return withSettings(db => {
        const profile = db.prepare('SELECT origin FROM active_relay WHERE id = 1').get()
        const origin = profile?.origin ?? relayOrigin(fallback)
        return { origin, registered: !!db.prepare('SELECT 1 FROM registered_relays WHERE origin = ?').get(origin) }
      })
    },
    confirmRegistration(origin) {
      withSettings(db => db.prepare('INSERT OR IGNORE INTO registered_relays VALUES (?)').run(origin))
    },
    activate(origin) {
      withSettings(db => transaction(db, () => {
        db.prepare('INSERT OR IGNORE INTO registered_relays VALUES (?)').run(origin)
        db.prepare('INSERT OR REPLACE INTO active_relay VALUES (1, ?)').run(origin)
      }))
    }
  }
}
