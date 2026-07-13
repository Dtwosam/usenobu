import fs from "node:fs";
import path from "node:path";
import {
  migrateUp,
  openDatabase,
  type AfterBuyDatabase,
} from "../db/index.js";

let cached: AfterBuyDatabase | null = null;
let cachedPath: string | null = null;

export function getWebDatabase(): AfterBuyDatabase {
  const dbPath =
    process.env.AFTERBUY_DB_PATH ??
    path.join(process.cwd(), "data", "afterbuy.web.sqlite");

  if (cached && cachedPath === dbPath) {
    return cached;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDatabase(dbPath);
  migrateUp(db);
  cached = db;
  cachedPath = dbPath;
  return db;
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
}
