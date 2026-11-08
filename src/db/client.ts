import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate";

export type Db = Database.Database;

// 打开数据库连接并应用迁移；:memory: 用于测试
export function openDatabase(dbPath?: string): Db {
  const file = dbPath ?? process.env.DATABASE_PATH ?? "data/app.db";
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

let singleton: Db | null = null;

// 服务端单例连接（SQLite 仅允许服务端访问）
export function getDb(): Db {
  singleton ??= openDatabase();
  return singleton;
}

export function closeDb(): void {
  singleton?.close();
  singleton = null;
}
