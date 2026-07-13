import { describe, expect, it } from "vitest";
import {
  getAppliedMigrations,
  listMigrations,
  migrateDown,
  migrateUp,
  openDatabase,
  tableExists,
  TABLE_NAMES,
} from "../../src/db/index.js";

describe("database migrations", () => {
  it("lists 0001 and 0002 migration pairs", () => {
    const migrations = listMigrations();
    expect(migrations.map((m) => m.id)).toEqual(["0001_init", "0002_matching"]);
  });

  it("applies cleanly and creates required tables", () => {
    const db = openDatabase(":memory:");
    try {
      const applied = migrateUp(db);
      expect(applied).toEqual(["0001_init", "0002_matching"]);
      expect(getAppliedMigrations(db)).toEqual(["0001_init", "0002_matching"]);

      for (const table of TABLE_NAMES) {
        expect(tableExists(db, table)).toBe(true);
      }
      expect(tableExists(db, "schema_migrations")).toBe(true);

      // Idempotent second up: no duplicate apply
      expect(migrateUp(db)).toEqual([]);
      expect(getAppliedMigrations(db)).toEqual(["0001_init", "0002_matching"]);
    } finally {
      db.close();
    }
  });

  it("is reversible step-by-step and re-applicable", () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      const reversed2 = migrateDown(db, undefined, 1);
      expect(reversed2).toEqual(["0002_matching"]);
      expect(tableExists(db, "product_fingerprints")).toBe(false);
      expect(tableExists(db, "purchases")).toBe(true);

      const reversed1 = migrateDown(db, undefined, 1);
      expect(reversed1).toEqual(["0001_init"]);
      expect(getAppliedMigrations(db)).toEqual([]);

      for (const table of ["policy_versions", "purchases", "product_matches", "price_observations"]) {
        expect(tableExists(db, table)).toBe(false);
      }

      const reapplied = migrateUp(db);
      expect(reapplied).toEqual(["0001_init", "0002_matching"]);
      for (const table of TABLE_NAMES) {
        expect(tableExists(db, table)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it("enforces purchase MVP checks and foreign keys without secrets", () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);

      db.prepare(
        `INSERT INTO policy_versions (
          id, policy_id, version, jurisdiction, purchase_channel, status,
          verified_at, source_url, window_days, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "pv-1",
        "target-us-online-price-match-v1",
        "v1",
        "US",
        "online",
        "active_freshness_sensitive",
        "2026-07-13T00:00:00.000Z",
        "https://www.target.com/help/articles/policies-guidelines/price-match-guarantee",
        14,
        "{}",
        "2026-07-13T00:00:00.000Z",
      );

      db.prepare(
        `INSERT INTO purchases (
          id, user_ref, target_product_url, purchase_price, currency, purchase_date,
          country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
          is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "pur-1",
        null,
        "https://www.target.com/p/example/-/A-12345678",
        29.99,
        "USD",
        "2026-07-01",
        "US",
        "CA",
        "target_online",
        "ABC-100",
        null,
        "12345678",
        0,
        null,
        "MONITORING_ACTIVE",
        "fp-1",
        "2026-07-15",
        "2026-07-13T00:00:00.000Z",
        "2026-07-13T00:00:00.000Z",
      );

      db.prepare(
        `INSERT INTO product_matches (
          id, purchase_id, lifecycle, fingerprint_id, seller_kind, seller_text,
          product_title, product_url, target_item_id, model_number, upc_or_gtin,
          brand, size, color, weight, quantity, observed_price, currency,
          is_target_plus, confirmed_at, fingerprint_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "pm-1",
        "pur-1",
        "locked",
        "fp-1",
        "target",
        "Target",
        "Example Widget",
        "https://www.target.com/p/example/-/A-12345678",
        "12345678",
        "ABC-100",
        null,
        null,
        null,
        null,
        null,
        null,
        24.99,
        "USD",
        0,
        "2026-07-13T12:00:00.000Z",
        "{}",
        "2026-07-13T12:00:00.000Z",
      );

      db.prepare(
        `INSERT INTO price_observations (
          id, purchase_id, fingerprint_id, provider_status, seller_kind, seller_text,
          product_title, product_url, target_item_id, model_number, upc_or_gtin,
          observed_price, currency, observed_at, is_target_plus, price_source_type,
          provider, engine, query, location, country, language, device,
          raw_result_hash, matching_rule_version, provenance_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "obs-1",
        "pur-1",
        "fp-1",
        "LIVE_TARGET_MATCH",
        "target",
        "Target",
        "Example Widget",
        "https://www.target.com/p/example/-/A-12345678",
        "12345678",
        "ABC-100",
        null,
        22.5,
        "USD",
        "2026-07-13T12:00:00.000Z",
        0,
        "THIRD_PARTY_SEARCH_OBSERVATION",
        "SerpApi",
        "google_shopping",
        "ABC-100 Target",
        "Austin, Texas, United States",
        "US",
        "en",
        "desktop",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "match-v1",
        "{}",
        "2026-07-13T12:00:00.000Z",
      );

      expect(() =>
        db
          .prepare(
            `INSERT INTO purchases (
              id, target_product_url, purchase_price, currency, purchase_date,
              country, purchase_channel, is_target_plus, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "pur-bad",
            "https://www.target.com/p/x",
            0,
            "USD",
            "2026-07-01",
            "US",
            "target_online",
            0,
            "MONITORING_ACTIVE",
            "2026-07-13T00:00:00.000Z",
            "2026-07-13T00:00:00.000Z",
          ),
      ).toThrow();

      expect(() =>
        db
          .prepare(
            `INSERT INTO product_matches (
              id, purchase_id, lifecycle, seller_kind, seller_text,
              product_title, product_url, is_target_plus, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "pm-orphan",
            "missing-purchase",
            "candidate",
            "target",
            "Target",
            "Orphan",
            "https://www.target.com/p/x",
            0,
            "2026-07-13T00:00:00.000Z",
          ),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
