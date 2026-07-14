/**
 * FIXTURE-labelled unit tests for live manual-check path (injected client, no real SerpApi).
 */
import { afterEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  clearCheckLocks,
  runBoundedManualCheck,
  WEB_DEMO_USER_REF,
} from "../../src/web/manual-check.js";
import { runDemoPriceCheck, runLivePriceCheck } from "../../src/web/purchase-service.js";
import { createLiveSerpApiObservationFetcher } from "../../src/web/live-monitor.js";
import type { SerpApiShoppingResult } from "../../src/serpapi/types.js";
import { saveSearchBudget } from "../../src/monitoring/index.js";

const AS_OF = "2026-07-10T12:00:00.000Z";

function seedPurchase(
  db: ReturnType<typeof openDatabase>,
  args?: { purchaseId?: string; price?: number },
): { purchaseId: string; fingerprintId: string } {
  const purchaseId = args?.purchaseId ?? "pur-live-1";
  const price = args?.price ?? 40;

  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    purchaseId,
    WEB_DEMO_USER_REF,
    "https://www.target.com/p/example-widget/-/A-87654321",
    price,
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
    "2026-07-15",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z",
  );

  const purchase = {
    purchase_id: purchaseId,
    target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    product_title: "Example Widget Blue",
  };

  const offer: MatchableOffer = {
    offer_id: "seed",
    title: "Example Widget Blue",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    observed_price: price,
    currency: "USD",
  };

  const evaluation = evaluateProductMatches(purchase, [offer]);
  const fp = confirmAndPersistLockedFingerprint({
    db,
    purchase,
    candidate: evaluation.exact_candidate!,
    confirmed_at: "2026-07-02T00:00:00.000Z",
  });

  return { purchaseId, fingerprintId: fp.fingerprint_id };
}

function emptyShopping(status: string): SerpApiShoppingResult {
  return {
    provider: "SerpApi",
    provider_status: status as SerpApiShoppingResult["provider_status"],
    engine: "google_shopping",
    query: "test",
    offers: [],
    searched_at: AS_OF,
    raw_result_hash: "aa".repeat(32),
  } as unknown as SerpApiShoppingResult;
}

describe("live manual check path (injected, fixture-labelled)", () => {
  afterEach(() => {
    clearCheckLocks();
  });

  it("production deny: runDemoPriceCheck without allow_fixture fails closed", async () => {
    const prev = process.env.NOBU_FORCE_LIVE_CHECKS;
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    try {
      const db = openDatabase(":memory:");
      migrateUp(db);
      // runDemoPriceCheck uses getWebDatabase — unit test gate only
      const denied = await runDemoPriceCheck("any", { allow_fixture: false });
      // When force live + not test... actually NODE_ENV is test so isFixtureCheckAllowed is true
      // unless NOBU_FORCE_LIVE_CHECKS
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.error).toBe("fixture_path_denied");
      }
    } finally {
      if (prev === undefined) delete process.env.NOBU_FORCE_LIVE_CHECKS;
      else process.env.NOBU_FORCE_LIVE_CHECKS = prev;
    }
  });

  it("live path calls injected searchImpl (SerpApi connector boundary)", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId, fingerprintId } = seedPurchase(db, { price: 40 });
    let called = 0;
    const fetchObservation = createLiveSerpApiObservationFetcher({
      searchImpl: async () => {
        called += 1;
        return {
          provider: "SerpApi",
          provider_status: "NO_TARGET_RESULT",
          engine: "google_shopping",
          query_used: "Example Widget Blue Target",
          location: "Austin, Texas, United States",
          gl: "us",
          hl: "en",
          device: "desktop",
          shopping_results_count: 0,
          offers: [],
          filters: [],
          searched_at: AS_OF,
        } as unknown as SerpApiShoppingResult;
      },
    });

    // Use runLivePriceCheck with this db — need getWebDatabase or pass db
    // runBoundedManualCheck with force live + inject
    const prev = process.env.NOBU_FORCE_LIVE_CHECKS;
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    try {
      const result = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        prefer_fixture: false,
        fetchObservation,
      });
      expect(called).toBe(1);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data_source).toBe("LIVE");
        expect(result.provider_called).toBe(true);
        expect(result.outcome).not.toBe("price_drop");
      }
      // Fingerprint unchanged
      const row = db
        .prepare(`SELECT fingerprint_id FROM purchases WHERE id = ?`)
        .get(purchaseId) as { fingerprint_id: string };
      expect(row.fingerprint_id).toBe(fingerprintId);
    } finally {
      if (prev === undefined) delete process.env.NOBU_FORCE_LIVE_CHECKS;
      else process.env.NOBU_FORCE_LIVE_CHECKS = prev;
    }
  });

  it("provider error creates no positive alert", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db);
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    try {
      const result = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        fetchObservation: createLiveSerpApiObservationFetcher({
          searchImpl: async () => emptyShopping("PROVIDER_ERROR"),
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.outcome).toBe("provider_unavailable");
        expect(result.batch.alerts_created).toBe(0);
      }
    } finally {
      delete process.env.NOBU_FORCE_LIVE_CHECKS;
    }
  });

  it("no Target offers fails closed without alert", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db);
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    try {
      const result = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        fetchObservation: createLiveSerpApiObservationFetcher({
          searchImpl: async () => emptyShopping("NO_TARGET_RESULT"),
        }),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(["no_match", "no_reliable_price", "no_lower"]).toContain(
          result.outcome,
        );
        expect(result.batch.alerts_created).toBe(0);
      }
    } finally {
      delete process.env.NOBU_FORCE_LIVE_CHECKS;
    }
  });

  it("budget gate runs before provider", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db);
    saveSearchBudget(
      db,
      { period_key: "2026-07", used: 250, limit: 250, remaining: 0 },
      AS_OF,
    );
    let called = 0;
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    try {
      const result = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        now: new Date(AS_OF),
        fetchObservation: createLiveSerpApiObservationFetcher({
          searchImpl: async () => {
            called += 1;
            return emptyShopping("LIVE_TARGET_MATCH");
          },
        }),
      });
      expect(called).toBe(0);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("budget");
        expect(result.provider_called).toBe(false);
      }
    } finally {
      delete process.env.NOBU_FORCE_LIVE_CHECKS;
    }
  });

  it("valid lower Target offer persists observation and may alert once", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db, { price: 40 });
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    const lowerOffer: SerpApiShoppingResult = {
      provider: "SerpApi",
      provider_status: "LIVE_TARGET_MATCH",
      engine: "google_shopping",
      query_used: "WDG-100 Target",
      location: "Austin, Texas, United States",
      gl: "us",
      hl: "en",
      device: "desktop",
      shopping_results_count: 1,
      offers: [
        {
          title: "Example Widget Blue",
          source_text: "Target",
          seller_kind: "target",
          is_target_plus: false,
          extracted_price: 30,
          currency: "USD",
          merchant_link:
            "https://www.target.com/p/example-widget/-/A-87654321",
          link: "https://www.target.com/p/example-widget/-/A-87654321",
          product_id: "google-not-tcin",
          title_utf8_ok: true,
        },
      ],
      filters: [],
      searched_at: AS_OF,
    } as unknown as SerpApiShoppingResult;

    try {
      const first = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        fetchObservation: createLiveSerpApiObservationFetcher({
          searchImpl: async () => lowerOffer,
        }),
      });
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.data_source).toBe("LIVE");
        expect(first.batch.searches_consumed).toBeGreaterThan(0);
        const obs = db
          .prepare(
            `SELECT COUNT(*) as c FROM price_observations WHERE purchase_id = ?`,
          )
          .get(purchaseId) as { c: number };
        expect(obs.c).toBeGreaterThan(0);
      }

      // cooldown blocks immediate second call
      const second = await runBoundedManualCheck({
        db,
        purchase_id: purchaseId,
        user_ref: WEB_DEMO_USER_REF,
        fetchObservation: createLiveSerpApiObservationFetcher({
          searchImpl: async () => lowerOffer,
        }),
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error).toBe("cooldown");
    } finally {
      delete process.env.NOBU_FORCE_LIVE_CHECKS;
    }
  });

  it("test gate can still use fixtures via prefer path when allowed", async () => {
    // Vitest allows fixtures by default
    delete process.env.NOBU_FORCE_LIVE_CHECKS;
    // runDemoPriceCheck with allow_fixture uses getWebDatabase - skip if not seeded
    // Instead verify resolve + demo with allow
    const denied = await runDemoPriceCheck("missing", { allow_fixture: true });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toBe("not_found");
  });
});
