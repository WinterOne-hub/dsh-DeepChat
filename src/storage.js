import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openDatabase(directory, name) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, name)
  closeSync(openSync(path, 'a', 0o600))
  const database = new DatabaseSync(path)
  database.exec('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
  return database
}

export function transaction(database, operation) {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = operation()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
