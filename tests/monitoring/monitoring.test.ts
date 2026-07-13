import { describe, expect, it } from "vitest";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  canConsumeSearches,
  consumeSearches,
  countAlertsForPurchase,
  runMonitoringPass,
  selectActivePurchases,
  snapshotBudget,
  type ObservationFetcher,
} from "../../src/monitoring/index.js";
import { migrateUp, openDatabase } from "../../src/db/index.js";

const AS_OF = "2026-07-10T12:00:00.000Z"; // day 9 after 2026-07-01

function seedConfirmedPurchase(
  db: ReturnType<typeof openDatabase>,
  args?: { purchaseId?: string; purchaseDate?: string; price?: number },
): { purchaseId: string; fingerprintId: string } {
  const purchaseId = args?.purchaseId ?? "pur-mon-1";
  const purchaseDate = args?.purchaseDate ?? "2026-07-01";
  const price = args?.price ?? 20;

  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    purchaseId,
    null,
    "https://www.target.com/p/example-widget/-/A-87654321",
    price,
    "USD",
    purchaseDate,
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
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z",
  );

  const purchase = {
    purchase_id: purchaseId,
    target_product_url: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    product_title: "Example Widget Blue",
    size: "10 oz",
    color: "blue",
  };

  const offer: MatchableOffer = {
    offer_id: "seed",
    title: "Example Widget Blue 10 oz",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    size: "10 oz",
    color: "blue",
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

function matchingLowerOffer(price: number): MatchableOffer {
  return {
    offer_id: "obs",
    title: "Example Widget Blue 10 oz",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    size: "10 oz",
    color: "blue",
    observed_price: price,
    currency: "USD",
  };
}

describe("search budget guard", () => {
  it("prevents silent overspend", () => {
    const b = snapshotBudget({ period_key: "2026-07", limit: 2, used: 2 });
    expect(canConsumeSearches(b, 1)).toBe(false);
    expect(() => consumeSearches(b, 1)).toThrow(/exhausted/i);
  });
});

describe("active-window selection", () => {
  it("selects active locked purchases and skips others", () => {
    const selected = selectActivePurchases(
      [
        {
          id: "a",
          status: "MONITORING_ACTIVE",
          purchase_price: 10,
          currency: "USD",
          purchase_date: "2026-07-01",
          purchase_channel: "target_online",
          country: "US",
          region: "TX",
          fingerprint_id: "fp1",
          monitoring_deadline: null,
          is_target_plus: 0,
          known_exclusion: null,
        },
        {
          id: "b",
          status: "MONITORING_ACTIVE",
          purchase_price: 10,
          currency: "USD",
          purchase_date: "2026-06-01",
          purchase_channel: "target_online",
          country: "US",
          region: "TX",
          fingerprint_id: "fp2",
          monitoring_deadline: null,
          is_target_plus: 0,
          known_exclusion: null,
        },
        {
          id: "c",
          status: "MATCH_REVIEW_REQUIRED",
          purchase_price: 10,
          currency: "USD",
          purchase_date: "2026-07-01",
          purchase_channel: "target_online",
          country: "US",
          region: "TX",
          fingerprint_id: "fp3",
          monitoring_deadline: null,
          is_target_plus: 0,
          known_exclusion: null,
        },
      ],
      AS_OF,
    );
    expect(selected.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("price monitoring loop", () => {
  it("creates exactly one alert on valid price drop and none on replay", async () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      const { purchaseId } = seedConfirmedPurchase(db, { price: 20 });

      const fetch: ObservationFetcher = () => ({
        offers: [matchingLowerOffer(12)],
        provider_status: "LIVE_TARGET_MATCH",
        observed_at: AS_OF,
        consumed_search: true,
        query: "WDG-100",
        raw_result_hash:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      const first = await runMonitoringPass({
        db,
        mode: "scheduled",
        as_of: AS_OF,
        fetchObservation: fetch,
      });
      expect(first.searches_consumed).toBe(1);
      expect(first.alerts_created).toBe(1);
      expect(first.results[0]?.alert_created).toBe(true);
      expect(first.results[0]?.potential_recovery).toBe(8);
      expect(countAlertsForPurchase(db, purchaseId)).toBe(1);

      const second = await runMonitoringPass({
        db,
        mode: "manual",
        as_of: AS_OF,
        purchase_id: purchaseId,
        fetchObservation: fetch,
      });
      expect(second.searches_consumed).toBe(1);
      expect(second.alerts_created).toBe(0);
      expect(second.results[0]?.alert_created).toBe(false);
      expect(second.results[0]?.notes).toContain("alert_idempotent_replay");
      expect(countAlertsForPurchase(db, purchaseId)).toBe(1);

      const obsCount = db
        .prepare(
          `SELECT COUNT(*) AS c FROM price_observations WHERE purchase_id = ?`,
        )
        .get(purchaseId) as { c: number };
      expect(obsCount.c).toBe(2);
    } finally {
      db.close();
    }
  });

  it("does not search expired purchases", async () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      seedConfirmedPurchase(db, {
        purchaseId: "pur-exp",
        purchaseDate: "2026-06-01",
        price: 20,
      });
      // Force status back to monitoring if confirmation set it — still expired by date
      db.prepare(
        `UPDATE purchases SET status = 'MONITORING_ACTIVE' WHERE id = ?`,
      ).run("pur-exp");

      let fetched = 0;
      const batch = await runMonitoringPass({
        db,
        mode: "scheduled",
        as_of: AS_OF,
        fetchObservation: () => {
          fetched += 1;
          return { offers: [], consumed_search: true };
        },
      });

      expect(fetched).toBe(0);
      expect(batch.searches_consumed).toBe(0);
      expect(
        batch.results.some((r) => r.skip_reason === "window_expired"),
      ).toBe(true);
      const status = db
        .prepare(`SELECT status FROM purchases WHERE id = ?`)
        .get("pur-exp") as { status: string };
      expect(status.status).toBe("WINDOW_EXPIRED");
    } finally {
      db.close();
    }
  });

  it("skips with recorded reason when budget is exhausted", async () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      seedConfirmedPurchase(db, { purchaseId: "pur-bud", price: 20 });

      // Exhaust budget for period
      db.prepare(
        `INSERT INTO search_budget_ledger (period_key, used_count, limit_count, updated_at)
         VALUES ('2026-07', 250, 250, ?)`,
      ).run(AS_OF);

      let fetched = 0;
      const batch = await runMonitoringPass({
        db,
        mode: "scheduled",
        as_of: AS_OF,
        fetchObservation: () => {
          fetched += 1;
          return {
            offers: [matchingLowerOffer(5)],
            consumed_search: true,
          };
        },
      });

      expect(fetched).toBe(0);
      expect(batch.searches_consumed).toBe(0);
      expect(batch.results[0]?.skip_reason).toBe("budget_exhausted");
      expect(countAlertsForPurchase(db, "pur-bud")).toBe(0);

      const run = db
        .prepare(
          `SELECT skip_reason, searches_consumed FROM monitor_runs WHERE purchase_id = ?`,
        )
        .get("pur-bud") as {
        skip_reason: string;
        searches_consumed: number;
      };
      expect(run.skip_reason).toBe("budget_exhausted");
      expect(run.searches_consumed).toBe(0);
    } finally {
      db.close();
    }
  });

  it("creates no alert on mismatch or ambiguous observations", async () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      seedConfirmedPurchase(db, { purchaseId: "pur-mis", price: 20 });

      const mismatch: ObservationFetcher = () => ({
        offers: [
          {
            offer_id: "bad",
            title: "Totally Different Product",
            seller_kind: "target",
            seller_text: "Target",
            is_target_plus: false,
            merchant_link: "https://www.target.com/p/other/-/A-11111111",
            target_item_id: "11111111",
            model_number: "ZZZ-1",
            observed_price: 1,
            currency: "USD",
          },
        ],
        provider_status: "LIVE_TARGET_MATCH",
        consumed_search: true,
      });

      const r1 = await runMonitoringPass({
        db,
        mode: "manual",
        as_of: AS_OF,
        purchase_id: "pur-mis",
        fetchObservation: mismatch,
      });
      expect(r1.alerts_created).toBe(0);
      expect(r1.results[0]?.match_ok).toBe(false);

      const ambiguous: ObservationFetcher = () => ({
        offers: [
          matchingLowerOffer(10),
          {
            ...matchingLowerOffer(9),
            offer_id: "other",
            title: "Example Widget Blue 10 oz Alt",
            target_item_id: "99999999",
            model_number: "WDG-999",
            merchant_link: "https://www.target.com/p/alt/-/A-99999999",
          },
        ],
        provider_status: "AMBIGUOUS_TARGET_RESULTS",
        consumed_search: true,
      });

      // For ambiguous: second offer may not match fingerprint; only first matches.
      // Use two matches with different identity both matching fingerprint is hard
      // if fingerprint is TCIN-locked. Simulate two TCIN matches by same TCIN
      // different serpapi — not ambiguous. Better: offerMatches both via model
      // when fingerprint has model. Our fingerprint has TCIN so only TCIN match.
      // Craft fingerprint model-only purchase for ambiguity test separately.

      expect(countAlertsForPurchase(db, "pur-mis")).toBe(0);
      expect(r1.results[0]?.notes.join(" ")).toMatch(/mismatch|suppressed/);
    } finally {
      db.close();
    }
  });

  it("suppresses alert when multiple locked matches are ambiguous", async () => {
    const db = openDatabase(":memory:");
    try {
      migrateUp(db);
      // Model-only fingerprint (no TCIN) so two different TCIN offers can both match model
      const purchaseId = "pur-amb";
      db.prepare(
        `INSERT INTO purchases (
          id, user_ref, target_product_url, purchase_price, currency, purchase_date,
          country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
          is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        purchaseId,
        null,
        "https://www.target.com/p/example-widget",
        20,
        "USD",
        "2026-07-01",
        "US",
        "TX",
        "target_online",
        "WDG-100",
        null,
        null,
        0,
        null,
        "MATCH_REVIEW_REQUIRED",
        null,
        null,
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:00.000Z",
      );

      const purchase = {
        purchase_id: purchaseId,
        target_product_url: "https://www.target.com/p/example-widget",
        target_item_id: null as string | null,
        model_number: "WDG-100",
        product_title: "Example Widget",
      };
      const seedOffer: MatchableOffer = {
        offer_id: "seed",
        title: "Example Widget WDG-100",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        merchant_link: "https://www.target.com/p/example-widget",
        model_number: "WDG-100",
        observed_price: 20,
        currency: "USD",
      };
      const evaluation = evaluateProductMatches(purchase, [seedOffer]);
      confirmAndPersistLockedFingerprint({
        db,
        purchase,
        candidate: evaluation.exact_candidate!,
        confirmed_at: "2026-07-02T00:00:00.000Z",
      });

      const batch = await runMonitoringPass({
        db,
        mode: "scheduled",
        as_of: AS_OF,
        purchase_id: purchaseId,
        fetchObservation: () => ({
          offers: [
            {
              offer_id: "a",
              title: "Example Widget WDG-100 Red",
              seller_kind: "target",
              seller_text: "Target",
              is_target_plus: false,
              merchant_link: "https://www.target.com/p/a/-/A-10000001",
              target_item_id: "10000001",
              model_number: "WDG-100",
              observed_price: 10,
              currency: "USD",
            },
            {
              offer_id: "b",
              title: "Example Widget WDG-100 Blue",
              seller_kind: "target",
              seller_text: "Target",
              is_target_plus: false,
              merchant_link: "https://www.target.com/p/b/-/A-10000002",
              target_item_id: "10000002",
              model_number: "WDG-100",
              observed_price: 9,
              currency: "USD",
            },
          ],
          provider_status: "AMBIGUOUS_TARGET_RESULTS",
          consumed_search: true,
        }),
      });

      expect(batch.alerts_created).toBe(0);
      expect(batch.results[0]?.match_ok).toBe(false);
      expect(batch.results[0]?.match_reasons).toContain(
        "ambiguous_multiple_locked_matches",
      );
      expect(countAlertsForPurchase(db, purchaseId)).toBe(0);
    } finally {
      db.close();
    }
  });
});
