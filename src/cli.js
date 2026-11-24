import { writeFileSync } from 'node:fs'
import { initializeDevice, openDevice } from './client.js'
import { backupDevice, restoreDevice } from './device-backup.js'
import { maxTextBytes } from './protocol.js'

const [, , directory, command, ...args] = process.argv
const commands = { init: 0, register: 0, invite: 0, trust: 2, send: 1, sync: 0, history: 0, save: 2, backup: 1, restore: 1 }

async function readInput(limit) {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > limit) throw new Error(`Input exceeds ${limit} UTF-8 bytes`)
    chunks.push(chunk)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
}

if (!directory || !Object.hasOwn(commands, command) || args.length !== commands[command]) {
  console.error('Usage: node src/cli.js STATE_DIR init|register|invite|trust NAME FINGERPRINT|send NAME|sync|history|save ID DESTINATION|backup ARCHIVE|restore ARCHIVE')
  console.error('trust reads the invitation from stdin. send reads the message from stdin.')
  console.error('backup and restore read the passphrase from stdin. Restore requires a new device directory.')
  process.exitCode = 1
} else if (command === 'backup' || command === 'restore') {
  try {
    const password = (await readInput(1026)).replace(/\r?\n$/, '')
    if (command === 'backup') await backupDevice(directory, args[0], password)
    else await restoreDevice(args[0], directory, password)
    console.log(command === 'backup' ? 'Encrypted device backup saved' : 'Device backup restored')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
} else {
  let device
  try {
    if (command === 'init') await initializeDevice(directory)
    device = openDevice(directory, { relay: process.env.DSH_CHAT_RELAY })
    let result
    switch (command) {
      case 'init':
      case 'register':
        await device.register()
        result = device.invitation()
        break
      case 'invite':
        result = device.invitation()
        break
      case 'trust':
        await device.trust(args[0], (await readInput(769)).trim(), args[1])
        result = { paired: args[0] }
        break
      case 'send':
        result = await device.send(args[0], await readInput(maxTextBytes))
        break
      case 'sync':
        result = await device.sync()
        break
      case 'history':
        result = await device.history()
        break
      case 'save': {
        const file = await device.download(args[0])
        if (!file) throw new Error('Attachment not found')
        writeFileSync(args[1], file.bytes, { flag: 'wx', mode: 0o600, flush: true })
        result = { saved: args[1], size: file.bytes.length }
        break
      }
    }
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    device?.close()
  }
}
