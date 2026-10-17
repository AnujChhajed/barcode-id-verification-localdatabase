import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { nowIso } from "../lib/time.js";

/**
 * Minimal forward-only migration runner.
 *
 * Each `.sql` file in `migrations/` is applied exactly once, in filename order,
 * inside a transaction, and recorded in `schema_migrations`. Because SQLite DDL
 * is transactional, an interrupted migration rolls back completely — the
 * database can never be left half-migrated.
 *
 * `schema_migrations` is created by the first migration itself, so the runner
 * only inspects it when it already exists.
 */

function schemaMigrationsExists(db) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  return Boolean(row);
}

export function migrationFiles(dir = config.migrationsDir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function appliedMigrations(db) {
  if (!schemaMigrationsExists(db)) return new Set();
  return new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => row.version),
  );
}

export function pendingMigrations(db, dir = config.migrationsDir) {
  const applied = appliedMigrations(db);
  return migrationFiles(dir).filter((file) => !applied.has(path.basename(file, ".sql")));
}

export function runMigrations(db, { dir = config.migrationsDir } = {}) {
  const results = [];
  for (const file of migrationFiles(dir)) {
    const version = path.basename(file, ".sql");
    if (appliedMigrations(db).has(version)) {
      results.push({ version, status: "skipped" });
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        nowIso(),
      );
    });
    apply();
    results.push({ version, status: "applied" });
    logger.info("migration applied", { version });
  }
  return results;
}
