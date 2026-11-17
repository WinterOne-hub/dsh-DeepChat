import { homedir } from 'node:os'
import { join } from 'node:path'
import manifest from '../package.json' with { type: 'json' }
import { maxFileBytes } from './bundle.js'
import { chatProfile } from './chat-profile.js'
import { chatRuntime } from './chat-runtime.js'
import { validText } from './protocol.js'

export const name = 'dsh-private-chat'
export const inject = ['connection', 'sessionQuery']
const apiPath = '/api/private-chat'
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
const localAuthority = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i
const maxRequestBytes = 240 * 1024

function json(body, status = 200) {
  return Response.json(body, { status, headers })
}

function sameOrigin(request, url) {
  const site = request.headers.get('sec-fetch-site')
  const origin = request.headers.get('origin')
  // The DSH HTTP carrier uses an internal URL and preserves the verified Host header.
  const authority = url.hostname === 'dsh.internal' ? request.headers.get('host') : url.host
  if (!localAuthority.test(authority) || request.headers.get('x-dsh-private-chat') !== '1' ||
      (site && site !== 'same-origin')) return false
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === origin &&
      new URL(`${parsed.protocol}//${authority}`).origin === origin
  } catch {
    return false
  }
}

export function shareableReplies(events) {
  const candidates = new Map()
  const replies = []
  for (const { type, seq, time, data, surfaceOp } of events) {
    if (type === 'assistant/message' && surfaceOp === 'append') candidates.set(data.turn, { seq, time, data })
    if (type !== 'turn/end') continue
    const candidate = candidates.get(data.turn)
    candidates.delete(data.turn)
    if (data.reason.kind !== 'completed' || !candidate || candidate.data.interrupted) continue
    const { content } = candidate.data.message
    if (!Array.isArray(content) || content.some(block => block.type === 'tool-call')) continue
    const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (validText(text)) replies.push({ seq: candidate.seq, time: candidate.time, text })
  }
  return replies.slice(-24).reverse()
}

async function parseInput(request) {
  if (request.headers.get('content-type') !== 'application/json' || !request.body) throw new Error('请求格式无效')
  const reader = request.body.getReader()
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > maxRequestBytes) throw new Error('请求超过大小限制')
      chunks.push(value)
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求格式无效')
    return body
  } finally {
    await reader.cancel()
  }
}

export function createHandler({ sessions, directory, deviceOptions = {}, pollMs = 10_000, readAccount }) {
  const chat = chatRuntime({ directory, deviceOptions, pollMs })
  const profile = chatProfile(directory, readAccount)
  async function sessionList() {
    const records = await sessions.listSessions()
    const ids = records.filter(record => record.header.origin !== 'subagent').slice(0, 24).map(record => record.header.id)
    const titles = await sessions.readTitleSnapshots(ids)
    return ids.map((id, index) => ({ id, title: titles[index]?.value?.title?.title ?? `会话 ${id.slice(0, 8)}` }))
  }

  async function handle(request) {
    const url = new URL(request.url)
    if (!sameOrigin(request, url)) return json({ error: '请从本机 DSH 界面打开 dsh-DeepChat' }, 403)
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: '请求方法无效' }, 405)
    try {
      if (request.method === 'GET') {
        const action = url.searchParams.get('action')
        if (action === 'sessions') return json(await sessionList())
        if (action === 'replies') {
          const id = url.searchParams.get('id')
          if (!id || id.length > 192 || /[/\\\p{Cc}]/u.test(id) || id === '.' || id === '..') {
            return json({ error: '请选择会话' }, 400)
          }
          const session = await sessions.readSession(id)
          return json(shareableReplies(session.events))
        }
        if (action === 'overview') return json({ ...await chat.overview(), version: manifest.version })
        if (action === 'state') {
          const overview = await chat.overview()
          const local = overview.ready ? await chat.read(async device => ({
            requests: device.requests(), conversations: await device.conversations()
          })) : { requests: [], conversations: [] }
          return json({ ...overview, ...local, profile: profile.get(), maxFileBytes })
        }
        if (action === 'conversation') {
          const alias = url.searchParams.get('id')
          const before = url.searchParams.get('before')
          return json(await chat.read(device => device.conversation(alias, before === null ? undefined : Number(before))))
        }
        if (action === 'contact-security') return json(await chat.read(device => device.contactFingerprint(url.searchParams.get('id'))))
        if (action !== 'download') return json({ error: '未知操作' }, 404)
        const file = await chat.read(device => device.download(url.searchParams.get('id')))
        if (!file) return json({ error: '附件不存在' }, 404)
        return new Response(file.bytes, {
          headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment' }
        })
      }

      const body = await parseInput(request)
      switch (body.action) {
        case 'preview-account-profile': return json(await profile.preview(body.client))
        case 'save-account-profile': {
          const saved = await profile.usePreview(body.ticket, body.client)
          chat.touch()
          return json(saved)
        }
        case 'save-manual-profile': {
          const saved = profile.saveManual(body.name)
          chat.touch()
          return json(saved)
        }
        case 'share-context': return json(await chat.read(device => device.selectedContext(body.alias, body.ids, body.includeFiles)))
        case 'test-relay': return json(await chat.test(body.origin))
        case 'register': return json(await chat.register(body.origin))
        case 'invite': return json(await chat.read(device => device.invitation()))
        case 'request-friend': return json(await chat.mutate(device => device.requestFriend(body.alias, body.code, body.fingerprint)))
        case 'decide-friend': return json(await chat.mutate(device => device.decideFriend(body.id, body.decision, body.alias, body.fingerprint)))
        case 'send': return json(await chat.mutate(device => device.send(body.alias, body.text)))
        case 'send-bundle': return json(await chat.mutate(device => device.sendBundle(body.alias, body)))
        case 'mark-read': {
          const changed = await chat.mutate(device => device.markRead(body.alias, body.position), Boolean)
          return json({ changed })
        }
        case 'sync': return json(await chat.sync())
        default: return json({ error: '未知操作' }, 404)
      }
    } catch (error) {
      const detail = typeof error.message === 'string' && /^[\p{L}\p{N} ().:-]{1,120}$/u.test(error.message)
        ? error.message : '请检查本机存储或投递服务后重试'
      return json({ error: detail }, 400)
    }
  }
  return Object.assign(handle, { start: chat.start, signedOut() { profile.signedOut(); chat.touch() } })
}

export function apply(ctx, config = {}) {
  const directory = process.env.DSH_CHAT_DEVICE || config.directory ||
    join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'private-chat')
  const relay = process.env.DSH_CHAT_RELAY || config.relay
  const fetch = createHandler({ sessions: ctx.sessionQuery, directory, deviceOptions: { relay },
    async readAccount(client) {
      const account = ctx.get('deepseekAccount')
      if (typeof account?.getProfile !== 'function') return null
      const result = await account.getProfile({
        version: typeof client?.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(client.version) ? client.version : '0.2.2',
        locale: typeof client?.locale === 'string' && /^[A-Za-z0-9-]{1,35}$/.test(client.locale) ? client.locale : 'zh-CN',
        timezoneOffsetSeconds: Number.isInteger(client?.timezoneOffsetSeconds) && Math.abs(client.timezoneOffsetSeconds) <= 86400
          ? client.timezoneOffsetSeconds : 0
      })
      if (result?.status !== 'ready') return null
      const { id, name, avatarUrl } = result.value
      const issuer = typeof account.origin === 'string' ? account.origin : undefined
      return { id, name, avatarUrl, issuer }
    }
  })
  ctx.connection.fetch.register({ path: apiPath, methods: ['GET'], requestBody: 'buffered', fetch })
  ctx.connection.fetch.register({ path: `${apiPath}/submit`, methods: ['POST'], requestBody: 'streaming', fetch })
  ctx.effect(fetch.start, 'private chat automatic sync')
  ctx.on('deepseek-account/signed-out', fetch.signedOut)
  ctx.on('deepseek-account/session-expired', fetch.signedOut)
}
