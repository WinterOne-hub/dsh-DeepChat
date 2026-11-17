import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { openRelay } from './relay.js'

export async function startLocalRelay(directory, port = 8611) {
  const relay = openRelay(directory)
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, async (incoming, outgoing) => {
    try {
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method, headers: incoming.headers,
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
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    relay.close()
    throw error
  }
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve))
  }
}
