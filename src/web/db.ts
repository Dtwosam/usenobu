import fs from "node:fs";
import path from "node:path";
import {
  migrateUp,
  openDatabase,
  type NobuDatabase,
} from "../db/index.js";

let cached: NobuDatabase | null = null;
let cachedPath: string | null = null;
let hydratedFromCookie = false;

export function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true";
}

/**
 * Resolve a writable SQLite path.
 * On Vercel the app filesystem is read-only; only /tmp is writable.
 */
export function resolveWebDbPath(): string {
  if (process.env.NOBU_DB_PATH) {
    return process.env.NOBU_DB_PATH;
  }
  if (isVercelRuntime()) {
    return path.join("/tmp", "nobu.web.sqlite");
  }
  return path.join(process.cwd(), "data", "nobu.web.sqlite");
}

export function getWebDatabase(): NobuDatabase {
  const dbPath = resolveWebDbPath();

  if (cached && cachedPath === dbPath) {
    return cached;
  }

  if (dbPath !== ":memory:") {
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch (err) {
      // Fall back to memory if mkdir fails (should not happen for /tmp)
      console.error("nobu_db_mkdir_failed", {
        dbPath,
        message: err instanceof Error ? err.message : String(err),
      });
      const mem = openDatabase(":memory:");
      migrateUp(mem);
      cached = mem;
      cachedPath = ":memory:";
      return mem;
    }
  }

  const db = openDatabase(dbPath);
  migrateUp(db);
  cached = db;
  cachedPath = dbPath;
  hydratedFromCookie = false;
  return db;
}

export function markCookieHydrated(value: boolean): void {
  hydratedFromCookie = value;
}

export function wasCookieHydrated(): boolean {
  return hydratedFromCookie;
}

/** Reset cache between E2E processes if path changes. */
export function resetWebDatabaseCache(): void {
  if (cached) {
    try {
      cached.close();
    } catch {
      // ignore
    }
  }
  cached = null;
  cachedPath = null;
  hydratedFromCookie = false;
}
