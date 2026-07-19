import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateProductMatches, type MatchableOffer } from "../../src/matching/index.js";
import { createPurchaseFlow, runLivePriceCheck, confirmPurchaseCandidate } from "../../src/web/purchase-service.js";
import { getWebDatabase, resetWebDatabaseCache } from "../../src/web/db.js";
import { saveEnrollmentDiscovery } from "../../src/web/discovery-store.js";

const NOW = new Date("2026-07-19T12:00:00.000Z");
let dbPath = "";

function seedPurchase(id = "pur_candidate_lock") {
  const db = getWebDatabase();
  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    "demo-user",
    "https://www.target.com/p/example-widget-blue/-/A-87654321",
    19.99,
    "USD",
    "2026-07-18",
    "US",
    "TX",
    "target_online",
    "WDG-100",
    "00012345678905",
    "87654321",
    0,
    null,
    "MATCH_REVIEW_REQUIRED",
    null,
    "2026-08-01",
    NOW.toISOString(),
    NOW.toISOString(),
  );
  return db;
}

function targetOffer(overrides: Partial<MatchableOffer> = {}): MatchableOffer {
  return {
    offer_id: "target-blue",
    title: "Example Widget Blue 10 oz",
    seller_kind: "target",
    seller_text: "Target",
    is_target_plus: false,
    merchant_link: "https://www.target.com/p/example-widget-blue/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    upc_or_gtin: "00012345678905",
    color: "blue",
    size: "10 oz",
    observed_price: 17.99,
    currency: "USD",
    thumbnail: "https://example.test/widget.png",
    ...overrides,
  };
}

function saveDiscovery(offers: MatchableOffer[], createdAt = NOW.toISOString()) {
  const db = getWebDatabase();
  const purchase = {
    purchase_id: "pur_candidate_lock",
    target_product_url: "https://www.target.com/p/example-widget-blue/-/A-87654321",
    target_item_id: "87654321",
    model_number: "WDG-100",
    upc_or_gtin: "00012345678905",
    product_title: "Example Widget Blue 10 oz",
    color: "blue",
    size: "10 oz",
  };
  const evaluation = evaluateProductMatches(purchase, offers);
  saveEnrollmentDiscovery(db, {
    purchase_id: "pur_candidate_lock",
    data_source: "LIVE",
    query: "Example Widget WDG-100 87654321 Target",
    provider_status: "LIVE_TARGET_MATCH",
    evaluation,
    offers,
    created_at: createdAt,
  });
  return evaluation;
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `nobu-candidate-${process.pid}-${Math.random()}.sqlite`);
  process.env.NOBU_DB_PATH = dbPath;
  resetWebDatabaseCache();
});

afterEach(() => {
  resetWebDatabaseCache();
  delete process.env.NOBU_DB_PATH;
  try {
    fs.unlinkSync(dbPath);
  } catch {
    // ignore
  }
});

describe("server-side candidate confirmation", () => {
  it("locks user-provided exact Target identity when live discovery has no strong provider candidate", async () => {
    const prevForce = process.env.NOBU_FORCE_LIVE_CHECKS;
    const prevSerp = process.env.SERPAPI_API_KEY;
    const prevSerpAlt = process.env.SERP_API_KEY;
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    process.env.SERPAPI_API_KEY = "";
    process.env.SERP_API_KEY = "";
    try {
      const created = await createPurchaseFlow({
        target_product_url:
          "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
        target_item_id: "54191097",
        purchase_price: "35",
        purchase_date: "2026-07-18",
        region: "TX",
      });

      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("purchase creation failed");
      expect(created.evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");
      expect(created.evaluation.reasons).toContain(
        "user_provided_purchase_identity",
      );
      expect(created.evaluation.exact_candidate?.offer.observed_price).toBeNull();
      expect(created.evaluation.exact_candidate?.offer.seller_kind).toBe("target");

      const before = await runLivePriceCheck(created.purchase_id, {
        fetchObservation: async () => {
          throw new Error("monitoring should not run before confirmation");
        },
        now: NOW,
      });
      expect(before).toMatchObject({ ok: false, error: "not_confirmed" });

      const confirmNow = new Date(
        created.evaluation.exact_candidate!.offer.observed_at!,
      );
      const confirmed = confirmPurchaseCandidate({
        purchase_id: created.purchase_id,
        candidate_id: created.evaluation.exact_candidate!.candidate_id,
        now: confirmNow,
      });
      expect(confirmed.ok).toBe(true);

      const after = await runLivePriceCheck(created.purchase_id, {
        fetchObservation: async () => ({
          offers: [
            {
              offer_id: "live-airtag",
              title: "Apple AirTag Bluetooth Tracker",
              seller_kind: "target",
              seller_text: "Target",
              is_target_plus: false,
              merchant_link:
                "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
              target_item_id: "54191097",
              observed_price: 29.99,
              currency: "USD",
            },
          ],
          provider_status: "LIVE_TARGET_MATCH",
          consumed_search: true,
        }),
        now: NOW,
      });
      expect(after.ok).toBe(true);
      if (after.ok) {
        expect(after.batch.alerts_created).toBe(1);
        expect(after.batch.results[0]?.observed_price).toBe(29.99);
      }
    } finally {
      if (prevForce === undefined) delete process.env.NOBU_FORCE_LIVE_CHECKS;
      else process.env.NOBU_FORCE_LIVE_CHECKS = prevForce;
      if (prevSerp === undefined) delete process.env.SERPAPI_API_KEY;
      else process.env.SERPAPI_API_KEY = prevSerp;
      if (prevSerpAlt === undefined) delete process.env.SERP_API_KEY;
      else process.env.SERP_API_KEY = prevSerpAlt;
    }
  });
  it("locks only a fresh server-stored exact Target candidate after explicit confirmation", async () => {
    seedPurchase();
    const evaluation = saveDiscovery([targetOffer()]);
    expect(evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");

    const before = await runLivePriceCheck("pur_candidate_lock", {
      fetchObservation: async () => {
        throw new Error("monitoring should not run before confirmation");
      },
      now: NOW,
    });
    expect(before).toMatchObject({ ok: false, error: "not_confirmed" });

    const result = confirmPurchaseCandidate({
      purchase_id: "pur_candidate_lock",
      candidate_id: evaluation.exact_candidate!.candidate_id,
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const row = getWebDatabase()
      .prepare(`SELECT status, fingerprint_id FROM purchases WHERE id = ?`)
      .get("pur_candidate_lock") as { status: string; fingerprint_id: string };
    expect(row.status).toBe("MONITORING_ACTIVE");
    expect(row.fingerprint_id).toMatch(/^fp_/);
  });

  it("rejects stale and tampered candidate ids", () => {
    seedPurchase();
    const evaluation = saveDiscovery(
      [targetOffer()],
      new Date(NOW.getTime() - 31 * 60 * 1000).toISOString(),
    );
    expect(
      confirmPurchaseCandidate({
        purchase_id: "pur_candidate_lock",
        candidate_id: evaluation.exact_candidate!.candidate_id,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, error: "stale_candidate" });

    getWebDatabase().prepare(`DELETE FROM enrollment_discovery`).run();
    saveDiscovery([targetOffer()], NOW.toISOString());
    expect(
      confirmPurchaseCandidate({
        purchase_id: "pur_candidate_lock",
        candidate_id: "cand_not_the_server_candidate",
        now: NOW,
      }),
    ).toMatchObject({ ok: false, error: "tampered_candidate" });
  });

  it("rejects weak, title-only, non-Target, Target Plus, and wrong-model selections", () => {
    seedPurchase();

    const titleOnly = saveDiscovery([
      targetOffer({
        offer_id: "title-only",
        merchant_link: null,
        target_item_id: null,
        model_number: null,
        upc_or_gtin: null,
        title: "Example Widget Blue-ish",
      }),
    ]);
    expect(titleOnly.decision).toBe("MATCH_REVIEW_REQUIRED");
    expect(
      confirmPurchaseCandidate({
        purchase_id: "pur_candidate_lock",
        candidate_id: titleOnly.candidates[0]!.candidate_id,
        now: NOW,
      }),
    ).toMatchObject({ ok: false, error: "cannot_confirm_weak_or_ambiguous" });

    for (const bad of [
      targetOffer({ offer_id: "wrong-seller", seller_kind: "other", seller_text: "Walmart" }),
      targetOffer({ offer_id: "target-plus", seller_kind: "target_plus", seller_text: "Target Plus", is_target_plus: true }),
      targetOffer({ offer_id: "wrong-model", model_number: "WDG-200" }),
    ]) {
      getWebDatabase().prepare(`DELETE FROM enrollment_discovery`).run();
      const evaluation = saveDiscovery([bad]);
      expect(evaluation.exact_candidate).toBeUndefined();
      const candidate = evaluation.candidates[0] ?? evaluation.rejected[0];
      expect(candidate).toBeDefined();
      expect(
        confirmPurchaseCandidate({
          purchase_id: "pur_candidate_lock",
          candidate_id: candidate!.candidate_id,
          now: NOW,
        }).ok,
      ).toBe(false);
    }
  });
});
