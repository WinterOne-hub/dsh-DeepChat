import { createHash, randomBytes } from 'node:crypto'
import {
  CompactEncrypt, CompactSign, compactDecrypt, compactVerify, decodeProtectedHeader,
  exportJWK, generateKeyPair, importJWK
} from 'jose'

export const retentionMs = 24 * 60 * 60 * 1000
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/
export const idPattern = /^[a-f0-9]{64}$/
export const messageIdPattern = /^[a-f0-9]{32}$/
export const maxTextBytes = 8192
export const maxEnvelopeBytes = 24576
export const hash = value => createHash('sha256').update(value).digest('hex')
export const matches = (pattern, value) => typeof value === 'string' && pattern.test(value)
const encode = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
const signAlgorithm = 'Ed25519'
const keyAlgorithm = 'ECDH-ES'
const encryptionAlgorithm = 'A256GCM'
const contentType = 'dsh-private-chat-prototype+json'

export async function createIdentity() {
  const signing = await generateKeyPair(signAlgorithm, { extractable: true })
  const encryption = await generateKeyPair(keyAlgorithm, { crv: 'X25519', extractable: true })
  const readToken = randomBytes(32).toString('base64url')
  return {
    readToken,
    writeToken: randomBytes(32).toString('base64url'),
    mailbox: hash(readToken),
    signingPublic: await exportJWK(signing.publicKey),
    signingPrivate: await exportJWK(signing.privateKey),
    encryptionPublic: await exportJWK(encryption.publicKey),
    encryptionPrivate: await exportJWK(encryption.privateKey)
  }
}

export function invitation(identity) {
  return {
    v: 1,
    mailbox: identity.mailbox,
    writeToken: identity.writeToken,
    signingKey: identity.signingPublic.x,
    encryptionKey: identity.encryptionPublic.x
  }
}

export const fingerprint = invite => hash(JSON.stringify(invite))
export const encodeInvitation = profile => Buffer.from(JSON.stringify(profile)).toString('base64url')

export async function readInvitation(encoded) {
  if (!/^[A-Za-z0-9_-]{1,768}$/.test(encoded)) throw new Error('Invalid invitation')
  const { v, mailbox, writeToken, signingKey, encryptionKey } = JSON.parse(
    decode.decode(Buffer.from(encoded, 'base64url'))
  )
  if (v !== 1 || !matches(idPattern, mailbox) ||
      [writeToken, signingKey, encryptionKey].some(key => !matches(tokenPattern, key))) {
    throw new Error('Invalid invitation')
  }
  await importJWK({ kty: 'OKP', crv: 'Ed25519', x: signingKey }, signAlgorithm)
  await importJWK({ kty: 'OKP', crv: 'X25519', x: encryptionKey }, keyAlgorithm)
  return { v, mailbox, writeToken, signingKey, encryptionKey }
}

export function newPayload(identity, recipient, now, content) {
  return {
    v: 1,
    id: randomBytes(16).toString('hex'),
    from: identity.mailbox,
    to: recipient.mailbox,
    expires: now + retentionMs,
    ...content
  }
}

export async function seal(identity, receiver, payload) {
  const signingKey = await importJWK(identity.signingPrivate, signAlgorithm)
  const encryptionKey = await importJWK({ kty: 'OKP', crv: 'X25519', x: receiver.encryptionKey }, keyAlgorithm)
  const wirePayload = payload.type === 'text'
    ? { ...payload, text: Buffer.from(payload.text, 'utf8').toString('base64url') }
    : payload
  const signed = await new CompactSign(encode.encode(JSON.stringify(wirePayload)))
    .setProtectedHeader({ alg: signAlgorithm, kid: identity.mailbox, typ: contentType })
    .sign(signingKey)
  return new CompactEncrypt(encode.encode(signed))
    .setProtectedHeader({ alg: keyAlgorithm, enc: encryptionAlgorithm, cty: contentType })
    .encrypt(encryptionKey)
}

export async function unseal(identity, sealed, findSender) {
  const key = await importJWK(identity.encryptionPrivate, keyAlgorithm)
  const { plaintext, protectedHeader } = await compactDecrypt(sealed, key, {
    keyManagementAlgorithms: [keyAlgorithm],
    contentEncryptionAlgorithms: [encryptionAlgorithm]
  })
  if (protectedHeader.cty !== contentType) throw new Error('Unknown encrypted content type')
  const signed = decode.decode(plaintext)
  const header = decodeProtectedHeader(signed)
  if (header.typ !== contentType || header.b64 === false || !matches(idPattern, header.kid)) throw new Error('Invalid sender')
  const message = JSON.parse(decode.decode(Buffer.from(signed.split('.')[1], 'base64url')))
  if (message.v !== 1 || message.from !== header.kid || !matches(idPattern, message.to) ||
      !matches(messageIdPattern, message.id) || !Number.isSafeInteger(message.expires)) {
    throw new Error('Invalid authenticated message')
  }

  // An invitation can authenticate proof of a new applicant's signing key. The user still verifies its fingerprint.
  const known = findSender(header.kid, message)
  const applicant = message.type === 'friend-request' ? await readInvitation(message.invite) : undefined
  if (applicant && (applicant.mailbox !== header.kid || (known && fingerprint(known) !== fingerprint(applicant)))) {
    throw new Error('Applicant identity does not match')
  }
  const sender = known ?? applicant
  if (!sender) throw new Error('Sender has not been paired')
  const signingKey = await importJWK({ kty: 'OKP', crv: 'Ed25519', x: sender.signingKey }, signAlgorithm)
  await compactVerify(signed, signingKey, { algorithms: [signAlgorithm] })

  if (message.type === 'text') {
    if (!matches(/^[A-Za-z0-9_-]+$/, message.text)) throw new Error('Invalid text encoding')
    message.text = decode.decode(Buffer.from(message.text, 'base64url'))
    if (!validText(message.text)) throw new Error('Invalid authenticated text')
  } else if (applicant) {
    message.applicant = applicant
  } else if (message.type === 'friend-response') {
    if (!matches(messageIdPattern, message.requestId) || !['accepted', 'rejected'].includes(message.decision)) {
      throw new Error('Invalid friend response')
    }
  } else if (!(message.type === 'receipt' && matches(messageIdPattern, message.replyTo)) &&
      message.type !== 'bundle' && message.type !== 'bundle-part') {
    throw new Error('Invalid authenticated payload')
  }
  return message
}

export function validText(value) {
  return typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= maxTextBytes
}
