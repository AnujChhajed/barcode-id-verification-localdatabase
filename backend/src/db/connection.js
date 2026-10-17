import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

/**
 * Opens the SQLite database with the pragmas the design depends on:
 *
 *   - journal_mode = WAL      concurrent readers while a writer commits
 *   - foreign_keys = ON       referential integrity is actually enforced
 *   - busy_timeout = 5000ms   brief lock contention waits instead of erroring
 *   - synchronous = NORMAL    safe with WAL, far fewer fsyncs
 *
 * These are runtime settings, not schema, so they are applied on every open.
 */
export function openDatabase(dbPath = config.dbPath) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("trusted_schema = OFF");
  return db;
}
