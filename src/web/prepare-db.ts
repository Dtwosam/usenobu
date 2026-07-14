import { getWebDatabase, markCookieHydrated } from "./db.js";
import { hydrateDatabaseFromCookie } from "./session-snapshot.js";
import type { NobuDatabase } from "../db/index.js";

/** Open DB and hydrate Vercel cookie snapshot before reads/writes. */
export async function prepareWebDatabase(): Promise<NobuDatabase> {
  const db = getWebDatabase();
  // Each request may carry a newer cookie; warm instances must re-hydrate.
  markCookieHydrated(false);
  await hydrateDatabaseFromCookie(db);
  return db;
}
