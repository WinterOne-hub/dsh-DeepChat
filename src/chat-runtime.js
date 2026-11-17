import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { initializeDevice, openDevice } from './client.js'
import { relayOrigin, relaySettings, testRelay } from './relay-settings.js'

export function chatRuntime({ directory, deviceOptions, pollMs }) {
  const settings = relaySettings(directory, deviceOptions.relay)
  const hasIdentity = () => existsSync(join(directory, 'identity.json'))
  const epoch = randomUUID()
  let generation = 0
  let connection = null
  let runningSync
  let queue = Promise.resolve()
  const changed = () => { generation++ }

  function schedule(work) {
    const result = queue.then(work)
    queue = result.catch(() => {})
    return result
  }

  async function withDevice(work, origin, legacyRelay = origin) {
    const device = openDevice(directory, { ...deviceOptions, relay: origin, legacyRelay })
    try {
      return await work(device)
    } finally {
      device.close()
    }
  }

  function setConnection(origin, status) {
    connection = { origin, status, lastSyncAt: status === 'connected' ? Date.now() : connection?.origin === origin ? connection.lastSyncAt : null }
  }

  function relaySummary(current) {
    const observed = connection?.origin === current.origin ? connection : null
    return { ...current, status: observed?.status ?? 'unknown', lastSyncAt: observed?.lastSyncAt ?? null }
  }

  function sync() {
    if (runningSync) return runningSync
    const task = schedule(async () => {
      const current = settings.get()
      return withDevice(async device => {
        try {
          if (!current.registered) {
            await device.register()
            settings.confirmRegistration(current.origin)
            changed()
          }
          const result = await device.sync({ onChange: changed })
          setConnection(current.origin, 'connected')
          return result
        } catch (error) {
          setConnection(current.origin, 'disconnected')
          throw error
        }
      }, current.origin)
    })
    runningSync = task
    const release = () => { if (runningSync === task) runningSync = undefined }
    void task.then(release, release)
    return task
  }

  return {
    touch: changed,
    start() {
      function tick() {
        if (hasIdentity()) void sync().catch(() => {})
      }
      const timer = setInterval(tick, pollMs)
      timer.unref()
      tick()
      return () => clearInterval(timer)
    },
    read(action) {
      return withDevice(action, settings.get().origin)
    },
    mutate(action, shouldNotify = () => true) {
      return schedule(async () => {
        try {
          const result = await withDevice(action, settings.get().origin)
          if (shouldNotify(result)) changed()
          return result
        } catch (error) {
          changed()
          throw error
        }
      })
    },
    async overview() {
      const current = settings.get()
      const result = { ready: hasIdentity(), revision: `${epoch}:${generation}:${Math.floor(Date.now() / 60_000)}`, unread: 0, pendingFriends: 0,
        relay: relaySummary(current) }
      if (result.ready) {
        await withDevice(device => {
          result.unread = device.unread()
          result.pendingFriends = device.pendingFriendCount()
        }, current.origin)
      }
      return result
    },
    async test(value) {
      const origin = relayOrigin(value)
      await testRelay(origin, deviceOptions.request)
      return { origin, reachable: true }
    },
    async register(value) {
      return schedule(async () => {
        const previous = settings.get()
        const origin = value === undefined ? previous.origin : relayOrigin(value)
        await testRelay(origin, deviceOptions.request)
        if (!hasIdentity()) await initializeDevice(directory)
        const invite = await withDevice(async device => {
          await device.register()
          return device.invitation()
        }, origin, previous.origin)
        settings.activate(origin)
        setConnection(origin, 'connected')
        changed()
        return { ...invite, relay: relaySummary({ origin, registered: true }) }
      })
    },
    sync
  }
}
