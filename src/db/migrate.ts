import type Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";

// 幂等迁移：在事务内执行未应用的迁移并记录，可安全重复执行
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((row) => row.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(migration.name);
    });
    apply();
  }
}
