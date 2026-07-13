import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { EMBEDDED_MIGRATIONS } from "./embedded-migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export type NobuDatabase = DatabaseSync;

export interface MigrationFile {
  id: string;
  upPath: string;
  downPath: string;
}

export interface MigrationSql {
  id: string;
  up: string;
  down: string;
}

/**
 * Prefer embedded SQL (works on Vercel where migrations/ may not be traced).
 * Fall back to filesystem for local CLI when files exist.
 */
export function listMigrationSql(migrationsDir = MIGRATIONS_DIR): MigrationSql[] {
  if (EMBEDDED_MIGRATIONS.length > 0) {
    return EMBEDDED_MIGRATIONS.map((m) => ({
      id: m.id,
      up: m.up,
      down: m.down,
    }));
  }

  // Filesystem fallback (should not hit in normal builds)
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(
      `No embedded migrations and migrations directory missing: ${migrationsDir}`,
    );
  }
  return listMigrations(migrationsDir).map((m) => ({
    id: m.id,
    up: fs.readFileSync(m.upPath, "utf8"),
    down: fs.readFileSync(m.downPath, "utf8"),
  }));
}

export function listMigrations(migrationsDir = MIGRATIONS_DIR): MigrationFile[] {
  // Prefer embedded ids so tests that only need ids still work without scandir
  if (EMBEDDED_MIGRATIONS.length > 0 && !fs.existsSync(migrationsDir)) {
    return EMBEDDED_MIGRATIONS.map((m) => ({
      id: m.id,
      upPath: path.join(migrationsDir, `${m.id}.sql`),
      downPath: path.join(migrationsDir, `${m.id}_down.sql`),
    }));
  }

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

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
): NobuDatabase {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function ensureMigrationsTable(db: NobuDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function getAppliedMigrations(db: NobuDatabase): string[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare("SELECT id FROM schema_migrations ORDER BY id ASC")
    .all() as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function migrateUp(
  db: NobuDatabase,
  migrationsDir = MIGRATIONS_DIR,
): string[] {
  ensureMigrationsTable(db);
  const applied = new Set(getAppliedMigrations(db));
  const appliedNow: string[] = [];

  for (const migration of listMigrationSql(migrationsDir)) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.up);
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
  db: NobuDatabase,
  migrationsDir = MIGRATIONS_DIR,
  steps = 1,
): string[] {
  ensureMigrationsTable(db);
  const applied = getAppliedMigrations(db);
  const reversed: string[] = [];
  const migrations = listMigrationSql(migrationsDir);
  const byId = new Map(migrations.map((m) => [m.id, m]));

  const toReverse = applied.slice().reverse().slice(0, steps);
  for (const id of toReverse) {
    const migration = byId.get(id);
    if (!migration) {
      throw new Error(`Applied migration ${id} has no matching SQL`);
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.down);
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

export function tableExists(db: NobuDatabase, table: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}
