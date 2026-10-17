import { config } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { migrationFiles, pendingMigrations, runMigrations } from "../src/db/migrate.js";

const db = openDatabase();
try {
  const before = pendingMigrations(db);
  const results = runMigrations(db);
  const applied = results.filter((row) => row.status === "applied");

  process.stdout.write(`database : ${config.dbPath}\n`);
  process.stdout.write(`discovered: ${migrationFiles().length}\n`);
  process.stdout.write(`pending   : ${before.length}\n`);
  for (const row of applied) process.stdout.write(`  applied ${row.version}\n`);
  process.stdout.write(
    `result    : ${applied.length} applied, ${results.length - applied.length} already current\n`,
  );
} finally {
  db.close();
}
