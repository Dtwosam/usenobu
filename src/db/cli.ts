/**
 * Optional local migration CLI. Uses SQLite file path from NOBU_DB_PATH
 * or defaults to ./data/nobu.local.sqlite (gitignored via *.sqlite).
 * No secrets required. Uses Node built-in node:sqlite (Node >= 22.5).
 */
import path from "node:path";
import {
  migrateDown,
  migrateUp,
  openDatabase,
} from "./migrator.js";

const command = process.argv[2] ?? "up";
const dbPath =
  process.env.NOBU_DB_PATH ??
  path.join(process.cwd(), "data", "nobu.local.sqlite");

const db = openDatabase(dbPath);

try {
  if (command === "up") {
    const applied = migrateUp(db);
    console.log(
      applied.length
        ? `Applied migrations: ${applied.join(", ")}`
        : "No pending migrations",
    );
  } else if (command === "down") {
    const reversed = migrateDown(db, undefined, 1);
    console.log(
      reversed.length
        ? `Reverted migrations: ${reversed.join(", ")}`
        : "No migrations to revert",
    );
  } else {
    console.error("Usage: tsx src/db/cli.ts [up|down]");
    process.exitCode = 1;
  }
} finally {
  db.close();
}
