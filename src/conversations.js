import { transaction } from './storage.js'

export function conversations(db) {
  transaction(db, () => {
    // Treat history imported from versions that lacked unread counters as already seen.
    const migrating = !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'conversation_reads'").get()
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_reads (mailbox TEXT PRIMARY KEY, seen_through INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS history_contact ON history (contact);
    `)
    if (migrating) db.exec(`INSERT INTO conversation_reads SELECT contact, max(rowid) FROM history GROUP BY contact`)
  })

  const list = db.prepare(`
    SELECT c.alias, h.id AS latest_id, h.expires, h.rowid AS latest_position,
      (SELECT count(*) FROM history AS pending
        WHERE pending.contact = c.mailbox AND pending.direction = 'in'
        AND pending.rowid > coalesce(r.seen_through, 0)) AS unread
    FROM contacts AS c
    LEFT JOIN conversation_reads AS r ON r.mailbox = c.mailbox
    LEFT JOIN history AS h ON h.rowid = (SELECT max(rowid) FROM history WHERE contact = c.mailbox)
    ORDER BY h.rowid DESC, c.alias
  `)
  const contact = db.prepare('SELECT mailbox FROM contacts WHERE alias = ?')
  const latest = db.prepare(`
    SELECT rowid AS position, * FROM history WHERE contact = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?
  `)
  const update = db.prepare(`
    INSERT INTO conversation_reads VALUES (?, ?)
    ON CONFLICT (mailbox) DO UPDATE SET seen_through = excluded.seen_through
    WHERE seen_through < excluded.seen_through
  `)
  return {
    list: () => list.all(),
    page(alias, before = Number.MAX_SAFE_INTEGER, limit = 40) {
      if (typeof alias !== 'string' || !Number.isSafeInteger(before) || before < 1) throw new Error('无效的会话')
      const row = contact.get(alias)
      if (!row) throw new Error('会话不存在')
      return latest.all(row.mailbox, before, limit + 1)
    },
    markRead(alias, position) {
      if (typeof alias !== 'string' || !Number.isSafeInteger(position) || position < 1) throw new Error('无效的已读位置')
      const target = db.prepare(`
        SELECT h.contact FROM history AS h JOIN contacts AS c ON h.contact = c.mailbox WHERE h.rowid = ? AND c.alias = ?
      `).get(position, alias)
      if (!target) throw new Error('消息不属于这个会话')
      return update.run(target.contact, position).changes > 0
    }
  }
}
