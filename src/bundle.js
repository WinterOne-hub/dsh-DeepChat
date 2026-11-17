import { hash, idPattern, matches, messageIdPattern, validText } from './protocol.js'

export const maxFileBytes = 128 * 1024
export const bundlePartBytes = 8192
export const maxBundleParts = 64

export function attachment(name, data) {
  if (typeof name !== 'string' || name === '.' || name === '..' ||
      !name.trim() || Buffer.byteLength(name) > 240 || /[/\\\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    throw new Error('Invalid attachment name')
  }
  if (!matches(/^[A-Za-z0-9_-]*$/, data) || data.length > Math.ceil(maxFileBytes * 4 / 3)) {
    throw new Error('Attachment exceeds 128 KiB or is invalid')
  }
  const bytes = Buffer.from(data, 'base64url')
  if (bytes.length > maxFileBytes || bytes.toString('base64url') !== data) throw new Error('Invalid attachment data')
  return { name, data, size: bytes.length, sha256: hash(bytes) }
}

export function validateBundle(message) {
  if (!validText(message.reply) || !message.file) throw new Error('Invalid material bundle')
  const file = attachment(message.file.name, message.file.data)
  if (file.size !== message.file.size || file.sha256 !== message.file.sha256) throw new Error('Attachment integrity check failed')
}

export function isBundlePart(part) {
  return matches(messageIdPattern, part.bundle) && part.bundle !== part.id &&
    Number.isInteger(part.total) && part.total > 0 && part.total <= maxBundleParts &&
    Number.isInteger(part.index) && part.index >= 0 && part.index < part.total &&
    matches(idPattern, part.digest) && matches(/^[A-Za-z0-9_.-]+$/, part.data) &&
    part.data.length <= bundlePartBytes && (part.index === part.total - 1 || part.data.length === bundlePartBytes)
}
