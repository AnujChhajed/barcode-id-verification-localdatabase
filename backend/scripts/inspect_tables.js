import Database from "better-sqlite3";
import path from "node:path";

const db = new Database("backend/data/abb-plant3.db");
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
for (const t of tables) {
  console.log(`=== TABLE: ${t.name} ===`);
  console.log(t.sql);
  const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get().c;
  console.log(`Count: ${count}`);
  const sample = db.prepare(`SELECT * FROM "${t.name}" LIMIT 3`).all();
  console.log("Sample:", JSON.stringify(sample, null, 2));
  console.log("\n");
}
