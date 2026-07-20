import fs from "node:fs";
import path from "node:path";

const dir = "src/db/migrations";
const ids = [
  "0001_init",
  "0002_matching",
  "0003_monitoring",
  "0004_policy_operations",
  "0005_policy_operations_r2a",
  "0006_accounts",
];
const entries = ids.map((id) => ({
  id,
  up: fs.readFileSync(path.join(dir, `${id}.sql`), "utf8"),
  down: fs.readFileSync(path.join(dir, `${id}_down.sql`), "utf8"),
}));

const body = JSON.stringify(entries, null, 2);
const out = `/** Embedded SQL migrations — production-safe (no runtime scandir of migrations/). */
export type EmbeddedMigration = { id: string; up: string; down: string };

export const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = ${body};
`;

fs.writeFileSync("src/db/embedded-migrations.ts", out);
console.log("wrote src/db/embedded-migrations.ts", out.length);
