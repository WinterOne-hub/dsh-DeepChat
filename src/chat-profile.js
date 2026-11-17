import { randomUUID } from 'node:crypto'
import { hash } from './protocol.js'
import { openDatabase, transaction } from './storage.js'

function displayName(value) {
  if (typeof value !== 'string') return ''
  return Array.from(value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '').trim()).slice(0, 64).join('')
}

function avatarUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}

export function chatProfile(directory, readAccount) {
  let preview
  let accountGeneration = 0

  function withProfile(work) {
    const db = openDatabase(directory, 'chat-profile.sqlite')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS display_profiles (scope TEXT PRIMARY KEY, name TEXT NOT NULL, avatar_url TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS active_profile (id INTEGER PRIMARY KEY CHECK (id = 1), scope TEXT NOT NULL);
      `)
      return work(db)
    } finally {
      db.close()
    }
  }

  function get() {
    return withProfile(db => {
      const scope = db.prepare('SELECT scope FROM active_profile WHERE id = 1').get()?.scope ?? 'manual'
      const row = db.prepare('SELECT name, avatar_url FROM display_profiles WHERE scope = ?').get(scope)
      return { name: row?.name ?? '', avatarUrl: row?.avatar_url ?? '', source: scope === 'manual' ? 'manual' : 'deepseek' }
    })
  }

  function save(scope, { name, avatar }) {
    withProfile(db => transaction(db, () => {
      db.prepare('INSERT OR REPLACE INTO display_profiles VALUES (?, ?, ?)').run(scope, name, avatar)
      db.prepare('INSERT OR REPLACE INTO active_profile VALUES (1, ?)').run(scope)
    }))
    return get()
  }

  async function account(metadata) {
    let raw
    try {
      raw = await readAccount?.(metadata)
    } catch {}
    const name = displayName(raw?.name)
    const avatar = avatarUrl(raw?.avatarUrl)
    if (!name && !avatar) throw new Error('DeepSeek 资料暂时不可用，请先登录 DSH 或手动填写昵称')
    const issuer = typeof raw.issuer === 'string' ? raw.issuer : 'https://platform.deepseek.com'
    const accountId = typeof raw.id === 'string' && raw.id.trim() ? raw.id : null
    const scope = accountId ? `deepseek:${hash(JSON.stringify([issuer, accountId]))}` : null
    return { name, avatar, scope, issuer }
  }

  return {
    get,
    saveManual(value) {
      preview = undefined
      const name = displayName(value)
      if (!name) throw new Error('请输入昵称')
      return save('manual', { name, avatar: '' })
    },
    async preview(metadata) {
      const generation = accountGeneration
      const profile = await account(metadata)
      if (generation !== accountGeneration) throw new Error('DeepSeek 账号已切换，请重新获取资料')
      const ticket = randomUUID()
      preview = { ticket, profile, expires: Date.now() + 5 * 60_000 }
      return { ticket, name: profile.name, avatarUrl: profile.avatar }
    },
    async usePreview(ticket, metadata) {
      const pending = preview
      if (!pending || pending.ticket !== ticket || pending.expires <= Date.now()) throw new Error('资料预览已过期，请重新获取')
      const current = await account(metadata)
      const { profile } = pending
      if (preview !== pending || current.scope !== profile.scope || current.issuer !== profile.issuer ||
          current.name !== profile.name || current.avatar !== profile.avatar) {
        throw new Error('DeepSeek 账号资料已变化，请重新获取')
      }
      preview = undefined
      return save(profile.scope ?? 'deepseek:unlinked', profile)
    },
    signedOut() {
      accountGeneration++
      preview = undefined
      withProfile(db => db.prepare("DELETE FROM active_profile WHERE scope <> 'manual'").run())
    }
  }
}
