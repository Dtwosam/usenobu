/**
 * Live discovery boundary + fixture gate tests (no live SerpApi network).
 */
import { describe, expect, it } from "vitest";
import {
  discoverLiveTargetCandidates,
  resolveDiscoveryDataSource,
} from "../../src/web/live-discovery.js";
import { evaluateProductMatches } from "../../src/matching/index.js";
import type { MatchableOffer } from "../../src/matching/types.js";
import {
  ensureEnrollmentDiscoveryTable,
  loadEnrollmentDiscovery,
  saveEnrollmentDiscovery,
} from "../../src/web/discovery-store.js";
import { openDatabase, migrateUp } from "../../src/db/index.js";

describe("resolveDiscoveryDataSource", () => {
  it("uses LIVE on production-like env without fixture flags", () => {
    expect(
      resolveDiscoveryDataSource({
        NODE_ENV: "production",
        VERCEL: "1",
      }),
    ).toBe("LIVE");
  });

  it("allows FIXTURE only when fixture gate is open", () => {
    expect(
      resolveDiscoveryDataSource({
        NODE_ENV: "test",
        VITEST: "true",
      }),
    ).toBe("FIXTURE");
    expect(
      resolveDiscoveryDataSource({
        NODE_ENV: "production",
        NOBU_FIXTURE_MODE: "1",
      }),
    ).toBe("FIXTURE");
    expect(
      resolveDiscoveryDataSource({
        NODE_ENV: "production",
        NOBU_FORCE_LIVE_CHECKS: "1",
        NOBU_FIXTURE_MODE: "1",
      }),
    ).toBe("LIVE");
  });
});

describe("discoverLiveTargetCandidates", () => {
  it("fails closed when SerpApi client is null (no fixtures)", async () => {
    const r = await discoverLiveTargetCandidates(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
        target_item_id: "54191097",
        model_number: "AirTag",
        product_title: "Apple AirTag",
      },
      { client: null },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("provider_not_configured");
      expect(r.message).toMatch(/could not find a reliable Target product/i);
    }
  });

  it("accepts Target AirTag offer with strong model evidence", () => {
    const offers: MatchableOffer[] = [
      {
        title: "Apple AirTag",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        observed_price: 29.99,
        currency: "USD",
        link: "https://www.google.com/search?ibp=oshop",
      },
      {
        title: "Apple AirTag Loop Case",
        seller_kind: "target",
        seller_text: "Target",
        is_target_plus: false,
        observed_price: 12.99,
        currency: "USD",
      },
    ];
    const evaluation = evaluateProductMatches(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
        target_item_id: "54191097",
        model_number: "AirTag",
        product_title: "Apple AirTag",
      },
      offers,
    );
    expect(evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");
    expect(evaluation.exact_candidate?.offer.title).toBe("Apple AirTag");
    // Accessory must not be the exact candidate
    expect(evaluation.exact_candidate?.offer.title).not.toMatch(/Loop Case/i);
  });
});

describe("enrollment discovery store", () => {
  it("persists and reloads evaluation snapshot", () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    ensureEnrollmentDiscoveryTable(db);
    const evaluation = evaluateProductMatches(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
        model_number: "AirTag",
        product_title: "Apple AirTag",
      },
      [
        {
          title: "Apple AirTag",
          seller_kind: "target",
          seller_text: "Target",
          is_target_plus: false,
          observed_price: 29.99,
          currency: "USD",
        },
      ],
    );
    saveEnrollmentDiscovery(db, {
      purchase_id: "pur_test",
      data_source: "LIVE",
      query: "Apple AirTag Target",
      provider_status: "AMBIGUOUS_TARGET_RESULTS",
      evaluation,
      offers: evaluation.candidates.map((c) => c.offer),
      created_at: "2026-07-14T00:00:00.000Z",
    });
    const loaded = loadEnrollmentDiscovery(db, "pur_test");
    expect(loaded?.data_source).toBe("LIVE");
    expect(loaded?.evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");
  });
});
