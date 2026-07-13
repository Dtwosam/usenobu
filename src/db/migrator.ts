import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export type AfterBuyDatabase = DatabaseSync;

export interface MigrationFile {
  id: string;
  upPath: string;
  downPath: string;
}

export function listMigrations(migrationsDir = MIGRATIONS_DIR): MigrationFile[] {
  const files = fs.readdirSync(migrationsDir);
  const ups = files
    .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith("_down.sql"))
    .sort();

  return ups.map((up) => {
    const id = up.replace(/\.sql$/, "");
    const down = `${id}_down.sql`;
    const downPath = path.join(migrationsDir, down);
    if (!fs.existsSync(downPath)) {
      throw new Error(`Missing down migration for ${up}: expected ${down}`);
    }
    return {
      id,
      upPath: path.join(migrationsDir, up),
      downPath,
    };
  });
}

export function openDatabase(
  filename: string | ":memory:" = ":memory:",
): AfterBuyDatabase {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function ensureMigrationsTable(db: AfterBuyDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function getAppliedMigrations(db: AfterBuyDatabase): string[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function migrateUp(
  db: AfterBuyDatabase,
  migrationsDir = MIGRATIONS_DIR,
): string[] {
  ensureMigrationsTable(db);
  const applied = new Set(getAppliedMigrations(db));
  const appliedNow: string[] = [];

  for (const migration of listMigrations(migrationsDir)) {
    if (applied.has(migration.id)) continue;
    const sql = fs.readFileSync(migration.upPath, "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
      ).run(migration.id, new Date().toISOString());
      db.exec("COMMIT");
      appliedNow.push(migration.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return appliedNow;
}

export function migrateDown(
  db: AfterBuyDatabase,
  migrationsDir = MIGRATIONS_DIR,
  steps = 1,
): string[] {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const reversed: string[] = [];
  const migrations = listMigrations(migrationsDir);
  const byId = new Map(migrations.map((m) => [m.id, m]));

  const toReverse = applied.slice().reverse().slice(0, steps);
  for (const id of toReverse) {
    const migration = byId.get(id);
    if (!migration) {
      throw new Error(`Applied migration ${id} has no matching files`);
    }
    const sql = fs.readFileSync(migration.downPath, "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("DELETE FROM schema_migrations WHERE id = ?").run(id);
      db.exec("COMMIT");
      reversed.push(id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return reversed;
}

export function tableExists(db: AfterBuyDatabase, table: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}
