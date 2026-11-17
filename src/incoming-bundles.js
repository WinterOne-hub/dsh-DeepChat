import { hash } from './protocol.js'
import { maxBundleParts } from './bundle.js'
import { transaction } from './storage.js'

export function incomingBundles(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incoming_bundle_parts (
      sender TEXT NOT NULL, bundle TEXT NOT NULL, part INTEGER NOT NULL, total INTEGER NOT NULL,
      digest TEXT NOT NULL, expires INTEGER NOT NULL, sealed TEXT NOT NULL,
      PRIMARY KEY (sender, bundle, part)
    );
    CREATE INDEX IF NOT EXISTS incoming_bundle_expiration ON incoming_bundle_parts (expires);
  `)
  const list = db.prepare('SELECT * FROM incoming_bundle_parts WHERE sender = ? AND bundle = ? ORDER BY part')
  const clear = db.prepare('DELETE FROM incoming_bundle_parts WHERE sender = ? AND bundle = ?')
  const prune = db.prepare('DELETE FROM incoming_bundle_parts WHERE expires <= ?')
  const history = db.prepare('SELECT 1 FROM history WHERE id = ?')
  const count = db.prepare('SELECT count(*) AS n FROM incoming_bundle_parts')
  const insert = db.prepare('INSERT INTO incoming_bundle_parts VALUES (?, ?, ?, ?, ?, ?, ?)')

  return {
    prune: now => prune.run(now),
    stage(part, sealed) {
      return transaction(db, () => {
        if (history.get(part.bundle)) return { received: 0 }
        let records = list.all(part.from, part.bundle)
        if (records.some(record => record.total !== part.total || record.digest !== part.digest || record.expires !== part.expires)) {
          return { discarded: 1 }
        }
        const existing = records.find(record => record.part === part.index)
        if (existing && existing.sealed !== sealed) return { discarded: 1 }
        if (!existing) {
          // Do not acknowledge a chunk the device could not keep. The sender's copy remains retryable.
          if (count.get().n >= maxBundleParts * 4) throw new Error('Incomplete material bundle storage is full')
          insert.run(part.from, part.bundle, part.index, part.total, part.digest, part.expires, sealed)
          records = list.all(part.from, part.bundle)
        }
        return records.length === part.total ? { records } : { received: 0 }
      })
    },
    clear: (sender, bundle) => clear.run(sender, bundle)
  }
}

export async function assembleBundle(records, trigger, open) {
  const fragments = []
  for (const record of records) {
    const part = await open(record.sealed)
    if (part.type !== 'bundle-part' || part.from !== trigger.from || part.to !== trigger.to ||
        part.bundle !== trigger.bundle || part.index !== record.part || part.total !== trigger.total ||
        part.digest !== trigger.digest || part.expires !== trigger.expires) throw new Error('Mismatched bundle part')
    fragments.push(part.data)
  }
  const envelope = fragments.join('')
  if (hash(envelope) !== trigger.digest) throw new Error('Material bundle was altered')
  const message = await open(envelope)
  if (message.type !== 'bundle' || message.id !== trigger.bundle || message.from !== trigger.from ||
      message.to !== trigger.to || message.expires !== trigger.expires) throw new Error('Mismatched material bundle')
  return { envelope, message }
}
