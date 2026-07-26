import { describe, expect, it } from "vitest";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  getLockedFingerprint,
  persistMatchEvaluation,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  listMigrationSql,
  migrateUp,
  openDatabase,
} from "../../src/db/index.js";

function seedPurchase(db: ReturnType<typeof openDatabase>, id: string): void {
  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    null,
    "https://www.target.com/p/example-widget/-/A-87654321",
    12.99,
    "USD",
    "2026-07-01",
    "US",
    "TX",
    "target_online",
    "WDG-100",
    null,
    "87654321",
    0,
    null,
    "MATCH_REVIEW_REQUIRED",
    null,
    null,
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z",
  );
}

describe("matching persistence", () => {
  it("persists candidates and locks fingerprint on confirmation", () => {
    const db = openDatabase(":memory:");
    try {
      const applied = migrateUp(db);
      // Derived, not frozen: a hardcoded list broke on every new migration
      // without anything actually being wrong. What matters here is that a
      // fresh database applies the full known migration set exactly once.
      expect(applied).toEqual(listMigrationSql().map((m) => m.id));
      expect(applied.length).toBeGreaterThan(0);
      seedPurchase(db, "pur-lock-1");

      const purchase = {
        purchase_id: "pur-lock-1",
        target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
        target_item_id: "87654321",
        model_number: "WDG-100",
        product_title: "Example Widget Blue",
        size: "10 oz",
        color: "blue",
      };

      const offer: MatchableOffer = {
        offer_id: "o1",
        title: "Example Widget Blue 10 oz",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
        target_item_id: "87654321",
        model_number: "WDG-100",
        size: "10 oz",
        color: "blue",
        observed_price: 9.99,
        currency: "USD",
        serpapi_product_id: "not-a-tcin",
      };

      const evaluation = evaluateProductMatches(purchase, [offer]);
      expect(evaluation.exact_candidate).toBeDefined();

      persistMatchEvaluation({
        db,
        purchaseId: "pur-lock-1",
        evaluation,
      });

      const fp = confirmAndPersistLockedFingerprint({
        db,
        purchase,
        candidate: evaluation.exact_candidate!,
        confirmed_at: "2026-07-13T19:00:00.000Z",
      });

      expect(fp.fingerprint_id).toBeTruthy();
      const stored = getLockedFingerprint(db, fp.fingerprint_id);
      expect(stored?.target_item_id).toBe("87654321");
      expect(stored?.confirmed_by_user).toBe(true);

      const purchaseRow = db
        .prepare(`SELECT fingerprint_id, status FROM purchases WHERE id = ?`)
        .get("pur-lock-1") as { fingerprint_id: string; status: string };
      expect(purchaseRow.fingerprint_id).toBe(fp.fingerprint_id);
      expect(purchaseRow.status).toBe("MONITORING_ACTIVE");

      const locked = db
        .prepare(
          `SELECT lifecycle, match_rule_version FROM product_matches WHERE fingerprint_id = ?`,
        )
        .get(fp.fingerprint_id) as {
        lifecycle: string;
        match_rule_version: string;
      };
      expect(locked.lifecycle).toBe("locked");
      expect(locked.match_rule_version).toBe("match-v1");
    } finally {
      db.close();
    }
  });
});
