import { describe, expect, it } from "vitest";
import {
  listMigrationSql,
  listMigrations,
  migrateUp,
  openDatabase,
  tableExists,
  TABLE_NAMES,
} from "../../src/db/index.js";
import { EMBEDDED_MIGRATIONS } from "../../src/db/embedded-migrations.js";
import { resolveWebDbPath, isVercelRuntime } from "../../src/web/db.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const EXPECTED_EMBEDDED_MIGRATIONS = [
  "0001_init",
  "0002_matching",
  "0003_monitoring",
  "0004_policy_operations",
  "0005_policy_operations_r2a",
  "0006_accounts",
];

describe("embedded migrations (production-safe)", () => {
  it("ships embedded SQL for 0001–0003", () => {
    expect(EMBEDDED_MIGRATIONS.map((m) => m.id)).toEqual(
      EXPECTED_EMBEDDED_MIGRATIONS,
    );
    for (const m of EMBEDDED_MIGRATIONS) {
      expect(m.up.length).toBeGreaterThan(50);
      expect(m.down.length).toBeGreaterThan(10);
    }
  });

  it("migrates using embedded SQL without filesystem migrations dir", () => {
    const db = openDatabase(":memory:");
    try {
      const missingDir = path.join(os.tmpdir(), "nobu-missing-migrations-dir");
      // Ensure dir does not exist
      fs.rmSync(missingDir, { recursive: true, force: true });
      const applied = migrateUp(db, missingDir);
      expect(applied).toEqual(EXPECTED_EMBEDDED_MIGRATIONS);
      for (const table of TABLE_NAMES) {
        expect(tableExists(db, table)).toBe(true);
      }
      expect(listMigrationSql(missingDir).map((m) => m.id)).toEqual(
        EXPECTED_EMBEDDED_MIGRATIONS,
      );
      // listMigrations should not throw when embedded exists
      expect(listMigrations(missingDir).map((m) => m.id)).toEqual(
        EXPECTED_EMBEDDED_MIGRATIONS,
      );
    } finally {
      db.close();
    }
  });
});

describe("web db path", () => {
  it("uses /tmp under Vercel-like env", () => {
    const prev = process.env.VERCEL;
    const prevPath = process.env.NOBU_DB_PATH;
    try {
      delete process.env.NOBU_DB_PATH;
      process.env.VERCEL = "1";
      expect(isVercelRuntime()).toBe(true);
      expect(resolveWebDbPath().replace(/\\/g, "/")).toContain("/tmp/");
    } finally {
      if (prev === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = prev;
      if (prevPath === undefined) delete process.env.NOBU_DB_PATH;
      else process.env.NOBU_DB_PATH = prevPath;
    }
  });
});
