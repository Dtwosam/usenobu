import { getWebDatabase } from "./db.js";
import { hydrateDatabaseFromCookie } from "./session-snapshot.js";
import type { NobuDatabase } from "../db/index.js";

/** Open DB and hydrate Vercel cookie snapshot before reads/writes. */
export async function prepareWebDatabase(): Promise<NobuDatabase> {
  const db = getWebDatabase();
  await hydrateDatabaseFromCookie(db);
  return db;
}
