import { startLocalRelay } from './relay-server.js'

const relay = await startLocalRelay(process.argv[2] ?? '.state/relay', Number(process.argv[3] ?? '8611'))
console.log(`Relay listening on ${relay.origin}`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void relay.close())
