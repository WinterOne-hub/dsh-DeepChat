import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { invitation } from './protocol.js'

const magic = Buffer.from('DSHCHAT1')
const maxDatabase = 128 * 1024 * 1024
const maxIdentity = 16 * 1024
const headerSize = magic.length + 16 + 12
const tagSize = 16
const deriveKey = promisify(scrypt)
const passwordOptions = { N: 65536, r: 8, p: 1, maxmem: 80 * 1024 * 1024 }

async function readBounded(path, limit) {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('File is too large or is not a regular file')
    const bytes = Buffer.alloc(stat.size)
    const { bytesRead } = await file.read(bytes, { position: 0 })
    if (bytesRead !== bytes.length || (await file.stat()).size !== bytes.length) throw new Error('File changed while being read')
    return bytes
  } finally {
    await file.close()
  }
}

function keyFor(password, salt) {
  if (typeof password !== 'string' || Array.from(password).length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Use a backup passphrase of at least 12 characters and at most 1024 UTF-8 bytes')
  }
  return deriveKey(password, salt, 32, passwordOptions)
}

export const maxPanelBackupBytes = 16 * 1024 * 1024

export async function createDeviceBackup(directory, password, { databaseLimit = maxDatabase } = {}) {
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const key = await keyFor(password, salt)
  const header = Buffer.concat([magic, salt, nonce])
  const identity = await readBounded(join(directory, 'identity.json'), maxIdentity)
  invitation(JSON.parse(identity.toString('utf8')))
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-chat-backup-'))
  try {
    const snapshot = join(temporary, 'device.sqlite')
    const database = new DatabaseSync(join(directory, 'device.sqlite'), { readOnly: true })
    try {
      const { page_count: pages } = database.prepare('PRAGMA page_count').get()
      const { page_size: pageSize } = database.prepare('PRAGMA page_size').get()
      if (pages * pageSize > databaseLimit) throw new Error(`设备数据库超过 ${databaseLimit / (1024 * 1024)} MiB 的备份上限`)
      await backup(database, snapshot)
    } finally {
      database.close()
    }
    const data = await readBounded(snapshot, databaseLimit)
    const length = Buffer.alloc(4)
    length.writeUInt32BE(identity.length)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(header)
    return Buffer.concat([header, cipher.update(length), cipher.update(identity), cipher.update(data), cipher.final(), cipher.getAuthTag()])
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function backupDevice(directory, destination, password) {
  const archive = await createDeviceBackup(directory, password)
  const output = await open(destination, 'wx', 0o600)
  try {
    try {
      await output.writeFile(archive)
      await output.sync()
    } finally {
      await output.close()
    }
  } catch (error) {
    await rm(destination, { force: true })
    throw error
  }
}

export async function restoreDevice(source, directory, password) {
  const archive = await readBounded(source, headerSize + 4 + maxIdentity + maxDatabase + tagSize)
  if (archive.length <= headerSize + tagSize + 4 || !archive.subarray(0, magic.length).equals(magic)) {
    throw new Error('Unsupported device backup format')
  }
  const header = archive.subarray(0, headerSize)
  const key = await keyFor(password, header.subarray(magic.length, magic.length + 16))
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(magic.length + 16))
  decipher.setAAD(header)
  decipher.setAuthTag(archive.subarray(-tagSize))
  let plaintext
  try {
    plaintext = Buffer.concat([decipher.update(archive.subarray(headerSize, -tagSize)), decipher.final()])
  } catch {
    throw new Error('Incorrect passphrase or damaged backup')
  }
  const identityLength = plaintext.readUInt32BE()
  const identity = plaintext.subarray(4, 4 + identityLength)
  const data = plaintext.subarray(4 + identityLength)
  if (identityLength > maxIdentity || data.length > maxDatabase || data.subarray(0, 16).toString() !== 'SQLite format 3\0') {
    throw new Error('Invalid device backup contents')
  }
  invitation(JSON.parse(identity.toString('utf8')))
  await mkdir(directory, { mode: 0o700 })
  try {
    const databasePath = join(directory, 'device.sqlite')
    const options = { flag: 'wx', mode: 0o600, flush: true }
    await writeFile(databasePath, data, options)
    const database = new DatabaseSync(databasePath, { readOnly: true })
    try {
      const check = database.prepare('PRAGMA quick_check').get()
      if (check.quick_check !== 'ok') throw new Error('Invalid device database')
    } finally {
      database.close()
    }
    // DSH only opens the device once the identity file exists.
    await writeFile(join(directory, 'identity.json'), identity, options)
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
