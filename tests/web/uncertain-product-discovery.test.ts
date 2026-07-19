import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISCOVERY_CANDIDATE_MAX,
  evaluateUncertainProductDiscovery,
  offerHasStableIdentity,
} from "../../src/matching/discovery-candidates.js";
import {
  confirmPurchaseCandidate,
  createPurchaseFlow,
  runLivePriceCheck,
} from "../../src/web/purchase-service.js";
import { getWebDatabase, resetWebDatabaseCache } from "../../src/web/db.js";
import { buildFixtureOffers } from "../../src/web/fixtures.js";
import {
  exportSnapshot,
  importSnapshot,
  clearDemoTables,
} from "../../src/web/session-snapshot.js";

const NOW = new Date("2026-07-19T12:00:00.000Z");
let dbPath = "";

beforeEach(() => {
  dbPath = path.join(
    os.tmpdir(),
    `nobu-uncertain-${process.pid}-${Math.random()}.sqlite`,
  );
  process.env.NOBU_DB_PATH = dbPath;
  process.env.NOBU_FIXTURE_MODE = "1";
  delete process.env.NOBU_FORCE_LIVE_CHECKS;
  resetWebDatabaseCache();
});

afterEach(() => {
  resetWebDatabaseCache();
  delete process.env.NOBU_DB_PATH;
  delete process.env.NOBU_FIXTURE_MODE;
  delete process.env.NOBU_FIXTURE_SCENARIO;
  try {
    fs.unlinkSync(dbPath);
  } catch {
    // ignore
  }
});

describe("uncertain multi-candidate discovery", () => {
  it("accepts description-only identity input in find mode", async () => {
    const created = await createPurchaseFlow({
      product_entry_mode: "find",
      product_description: "Apple AirPods",
      purchase_price: "99.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "multi_candidate",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    expect(created.evaluation.candidates.length).toBeGreaterThanOrEqual(3);
    expect(created.evaluation.candidates.length).toBeLessThanOrEqual(
      DISCOVERY_CANDIDATE_MAX,
    );
  });

  it("fixture discovery displays multiple Target candidates and excludes noise", () => {
    const offers = buildFixtureOffers({
      scenario: "multi_candidate",
      target_product_url: "https://www.target.com/p/pending-identity-discovery",
      product_title: "Apple AirPods",
    });
    expect(offers.some((o) => o.seller_text === "Walmart")).toBe(true);
    expect(offers.some((o) => o.is_target_plus)).toBe(true);

    const evaluation = evaluateUncertainProductDiscovery(
      {
        target_product_url:
          "https://www.target.com/p/pending-identity-discovery",
        product_title: "Apple AirPods",
      },
      offers,
    );

    // Non-Target and Target Plus excluded from candidates list
    for (const c of evaluation.candidates) {
      expect(c.offer.seller_kind).toBe("target");
      expect(c.offer.is_target_plus).toBe(false);
    }

    // Duplicate TCIN 54191091 collapsed
    const tcins = evaluation.candidates
      .map((c) => c.offer.target_item_id)
      .filter(Boolean);
    const unique = new Set(tcins);
    expect(unique.size).toBe(tcins.length);

    // Bounded
    expect(evaluation.candidates.length).toBeLessThanOrEqual(
      DISCOVERY_CANDIDATE_MAX,
    );
    expect(evaluation.candidates.length).toBeGreaterThanOrEqual(3);

    // No automatic confirmation among multi candidates
    expect(evaluation.exact_candidate).toBeUndefined();
    expect(evaluation.decision).toBe("MATCH_REVIEW_REQUIRED");
    expect(evaluation.reasons.join(" ")).toMatch(/multi_candidate|uncertain/i);
  });

  it("does not auto-confirm any discovery candidate", async () => {
    const created = await createPurchaseFlow({
      product_entry_mode: "find",
      product_description: "Apple AirPods",
      purchase_price: "99.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "multi_candidate",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");
    expect(created.evaluation.exact_candidate).toBeUndefined();

    const before = await runLivePriceCheck(created.purchase_id, {
      fetchObservation: async () => {
        throw new Error("monitoring blocked before confirmation");
      },
      now: NOW,
    });
    expect(before).toMatchObject({ ok: false, error: "not_confirmed" });
  });

  it("confirms a stable selected identity and blocks title-only", async () => {
    const created = await createPurchaseFlow({
      product_entry_mode: "find",
      product_description: "Apple AirPods",
      purchase_price: "99.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "multi_candidate",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const confirmNow = new Date();
    const titleOnly = created.evaluation.candidates.find((c) => c.title_only);
    if (titleOnly) {
      const blocked = confirmPurchaseCandidate({
        purchase_id: created.purchase_id,
        candidate_id: titleOnly.candidate_id,
        now: confirmNow,
      });
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error).toBe("cannot_confirm_weak_or_ambiguous");
      }
    } else {
      // Ensure title-only offers are non-confirmable when present in fixtures
      const weak = created.evaluation.candidates.find(
        (c) => !offerHasStableIdentity(c.offer),
      );
      if (weak) {
        const blocked = confirmPurchaseCandidate({
          purchase_id: created.purchase_id,
          candidate_id: weak.candidate_id,
          now: confirmNow,
        });
        expect(blocked.ok).toBe(false);
      }
    }

    const stable = created.evaluation.candidates.find(
      (c) =>
        c.decision === "EXACT_MATCH_CANDIDATE" &&
        !c.title_only &&
        offerHasStableIdentity(c.offer),
    );
    expect(stable).toBeTruthy();
    const confirmed = confirmPurchaseCandidate({
      purchase_id: created.purchase_id,
      candidate_id: stable!.candidate_id,
      now: confirmNow,
    });
    expect(confirmed.ok).toBe(true);
  });

  it("preserves offer_id through cookie snapshot compaction for multi-candidate", async () => {
    const created = await createPurchaseFlow({
      product_entry_mode: "find",
      product_description: "Apple AirPods",
      purchase_price: "99.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "multi_candidate",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const db = getWebDatabase();
    const snap = exportSnapshot(db);
    expect(snap.enrollment_discovery.length).toBe(1);
    const row = snap.enrollment_discovery[0]!;
    const offers = JSON.parse(String(row.offers_json)) as Array<{
      offer_id?: string;
    }>;
    expect(offers.length).toBeGreaterThanOrEqual(3);
    for (const o of offers) {
      expect(o.offer_id).toBeTruthy();
    }

    // Simulate cross-instance: clear and re-import compacted cookie snapshot
    clearDemoTables(db);
    importSnapshot(db, snap);

    const stable = created.evaluation.candidates.find(
      (c) => c.decision === "EXACT_MATCH_CANDIDATE" && !c.title_only,
    )!;
    const confirmed = confirmPurchaseCandidate({
      purchase_id: created.purchase_id,
      candidate_id: stable.candidate_id,
      now: new Date(),
    });
    expect(confirmed.ok).toBe(true);
  });

  it("exact mode still accepts URL alone and TCIN alone", async () => {
    const urlOnly = await createPurchaseFlow({
      product_entry_mode: "exact",
      target_product_url:
        "https://www.target.com/p/example-widget/-/A-87654321",
      purchase_price: "24.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "exact_match",
    });
    expect(urlOnly.ok).toBe(true);

    const tcinOnly = await createPurchaseFlow({
      product_entry_mode: "exact",
      target_item_id: "87654321",
      purchase_price: "24.99",
      purchase_date: "2026-07-18",
      region: "TX",
      fixture_scenario: "exact_match",
    });
    expect(tcinOnly.ok).toBe(true);
    if (tcinOnly.ok) {
      expect(tcinOnly.purchase.target_item_id).toBe("87654321");
      expect(tcinOnly.purchase.target_product_url).toContain("A-87654321");
    }
  });

  it("provider failure does not erase link-derived title fallback on exact identity", async () => {
    const prevForce = process.env.NOBU_FORCE_LIVE_CHECKS;
    const prevSerp = process.env.SERPAPI_API_KEY;
    const prevMode = process.env.NOBU_FIXTURE_MODE;
    process.env.NOBU_FORCE_LIVE_CHECKS = "1";
    process.env.SERPAPI_API_KEY = "";
    delete process.env.NOBU_FIXTURE_MODE;
    try {
      const created = await createPurchaseFlow({
        product_entry_mode: "exact",
        target_product_url:
          "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
        purchase_price: "35",
        purchase_date: "2026-07-18",
        region: "TX",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error("create failed");
      // Link-derived provisional title remains when provider is unavailable
      expect(String(created.product_title ?? "")).toMatch(/airtag|Target item/i);
      expect(created.evaluation.reasons).toContain(
        "user_provided_purchase_identity",
      );
    } finally {
      if (prevForce === undefined) delete process.env.NOBU_FORCE_LIVE_CHECKS;
      else process.env.NOBU_FORCE_LIVE_CHECKS = prevForce;
      if (prevSerp === undefined) delete process.env.SERPAPI_API_KEY;
      else process.env.SERPAPI_API_KEY = prevSerp;
      if (prevMode === undefined) delete process.env.NOBU_FIXTURE_MODE;
      else process.env.NOBU_FIXTURE_MODE = prevMode;
    }
  });
});

describe("production form has no demo options control", () => {
  it("purchase form source does not render Demo options", () => {
    const formPath = path.join(
      process.cwd(),
      "app",
      "purchases",
      "new",
      "PurchaseIntake.tsx",
    );
    const src = fs.readFileSync(formPath, "utf8");
    expect(src).not.toMatch(/Demo options/i);
    expect(src).not.toMatch(/input-scenario/);
    expect(src).not.toMatch(/fixture_scenario/);
    expect(src).toMatch(/mode-exact/);
    expect(src).toMatch(/mode-find/);
  });
});
