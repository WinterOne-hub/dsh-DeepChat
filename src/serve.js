import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { openRelay } from './relay.js'

const directory = process.argv[2] ?? '.state/relay'
const port = Number(process.argv[3] ?? '8611')
const relay = openRelay(directory)
const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (incoming, outgoing) => {
  try {
    const request = new Request(`http://127.0.0.1${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === 'GET' || incoming.method === 'HEAD'
        ? {} : { body: Readable.toWeb(incoming), duplex: 'half' })
    })
    const response = await relay.handle(request)
    outgoing.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing)
    else outgoing.end()
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500)
    outgoing.end()
  }
})
server.on('close', () => relay.close())
server.listen(port, '127.0.0.1', () => {
  console.log(`Relay listening on http://127.0.0.1:${server.address().port}`)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close())
