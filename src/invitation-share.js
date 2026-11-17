import qrcode from 'qrcode-generator'
import { fingerprint, readInvitation } from './protocol.js'
import { relayOrigin } from './relay-settings.js'

const project = 'https://github.com/WinterOne-hub/dsh-DeepChat'

export function shareInvitation(invite, origin) {
  const relay = relayOrigin(origin)
  if (relay.length > 512) throw new Error('投递服务地址过长，请使用邀请码添加好友')
  const payload = Buffer.from(JSON.stringify({ v: 1, code: invite.code, relay })).toString('base64url')
  const link = `${project}#deepchat=${payload}`
  const qr = qrcode(0, 'M')
  qr.addData(link)
  qr.make()
  return { ...invite, link, relay, qr: qr.createDataURL(4) }
}

export async function readSharedInvitation(value) {
  if (typeof value !== 'string' || value.length > 2300) throw new Error('请粘贴有效的邀请码或邀请链接')
  let code = value.trim()
  let relay = null
  if (code.startsWith('https://')) {
    let payload
    try {
      const url = new URL(code)
      if (url.origin + url.pathname !== project || url.search || url.username || url.password ||
          !/^#deepchat=[A-Za-z0-9_-]+$/.test(url.hash)) throw new Error()
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(url.hash.slice(10), 'base64url')))
      if (payload.v !== 1 || typeof payload.relay !== 'string' || payload.relay.length > 512) throw new Error()
      relay = relayOrigin(payload.relay)
      code = payload.code
    } catch {
      throw new Error('邀请链接无效，请让对方重新复制')
    }
  }
  const profile = await readInvitation(code)
  return { code, relay, fingerprint: fingerprint(profile) }
}
