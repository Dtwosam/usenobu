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
import { buildMonitorShoppingQuery } from "../../src/web/live-monitor.js";
import { SellerKind, ProviderStatus } from "../../src/domain/enums.js";
import type {
  SerpApiShoppingClient,
  SerpApiShoppingQuery,
} from "../../src/serpapi/index.js";

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
      expect(r.diagnostics).toMatchObject({
        provider_calls_used: 0,
        shopping_results_count: 0,
        target_source_results_count: 0,
        normalized_candidates_count: 0,
        strong_candidates_count: 0,
        query_strategy_identifier: "title_contains_model",
      });
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

  it("uses URL-derived TCIN and slug title without requiring model or UPC", async () => {
    const queries: string[] = [];
    const client = {
      async searchShopping(query: SerpApiShoppingQuery) {
        queries.push(query.q ?? "");
        return {
          provider: "SerpApi",
          engine: "google_shopping",
          provider_status: ProviderStatus.LIVE_TARGET_MATCH,
          query: {
            q: query.q ?? "",
            gl: "us",
            hl: "en",
            location: "Austin, Texas, United States",
            device: "desktop",
            no_cache: false,
          },
          observed_at: "2026-07-19T00:00:00.000Z",
          offers: [
            {
              title: "Apple AirTag Bluetooth Tracker",
              title_utf8_ok: true,
              source_text: "Target",
              seller_kind: SellerKind.TARGET,
              is_target_plus: false,
              merchant_link:
                "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
              link: "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
              extracted_price: 29.99,
              currency: "USD",
            },
          ],
          target_offers: [
            {
              title: "Apple AirTag Bluetooth Tracker",
              title_utf8_ok: true,
              source_text: "Target",
              seller_kind: SellerKind.TARGET,
              is_target_plus: false,
              merchant_link:
                "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
              link: "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
              extracted_price: 29.99,
              currency: "USD",
            },
          ],
          result_counts: {
            shopping_results_count: 1,
            inline_shopping_results_count: 0,
            categorized_results_count: 0,
            organic_results_count: 0,
            normalized_offers_count: 1,
            target_offers_count: 1,
          },
          filters: [],
          target_shoprs_tokens: [],
          live: true,
          searches_recorded: 1,
          raw_result_hash:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        };
      },
      async searchImmersiveProduct() {
        throw new Error("immersive should not run for exact URL evidence");
      },
    } as Partial<SerpApiShoppingClient> as SerpApiShoppingClient;

    const result = await discoverLiveTargetCandidates(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag-bluetooth-tracker/-/A-54191097",
        target_item_id: "54191097",
        product_title: "apple airtag bluetooth tracker",
      },
      { client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toBe("apple airtag bluetooth tracker 54191097 Target");
      expect(queries).toEqual([result.query]);
      expect(result.searches_consumed_estimate).toBe(1);
      expect(result.diagnostics).toMatchObject({
        provider_calls_used: 1,
        shopping_results_count: 1,
        categorized_results_count: 0,
        target_source_results_count: 1,
        immersive_enrichment_used: false,
        immersive_offers_count: 0,
        target_offers_after_enrichment: 1,
        normalized_candidates_count: 1,
        strong_candidates_count: 1,
        query_strategy_identifier: "title_slug_primary",
      });
      expect(result.evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");
    }
  });

  it("records rejection reasons and exact provider calls after immersive enrichment", async () => {
    const client = {
      async searchShopping(query: SerpApiShoppingQuery) {
        const offer = {
          title: "Apple AirTag Case",
          title_utf8_ok: true,
          source_text: "Target",
          seller_kind: SellerKind.TARGET,
          is_target_plus: false,
          immersive_product_page_token: "immersive-case",
          extracted_price: 9.99,
          currency: "USD" as const,
        };
        return {
          provider: "SerpApi",
          engine: "google_shopping",
          provider_status: ProviderStatus.LIVE_TARGET_MATCH,
          query: {
            q: query.q ?? "",
            gl: "us",
            hl: "en",
            location: "Austin, Texas, United States",
            device: "desktop",
            no_cache: false,
          },
          observed_at: "2026-07-19T00:00:00.000Z",
          offers: [
            offer,
            {
              title: "Apple AirTag",
              title_utf8_ok: true,
              source_text: "Walmart",
              seller_kind: SellerKind.OTHER,
              is_target_plus: false,
              extracted_price: 28.99,
              currency: "USD" as const,
            },
          ],
          target_offers: [offer],
          result_counts: {
            shopping_results_count: 1,
            inline_shopping_results_count: 0,
            categorized_results_count: 0,
            organic_results_count: 0,
            normalized_offers_count: 1,
            target_offers_count: 1,
          },
          filters: [],
          target_shoprs_tokens: [],
          live: true,
          searches_recorded: 1,
          raw_result_hash:
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        };
      },
      async searchImmersiveProduct() {
        return {
          product_results: {
            stores: [
              {
                name: "Target",
                link: "https://www.target.com/p/apple-airtag-case/-/A-11111111",
                title: "Apple AirTag Case",
                extracted_price: 9.99,
              },
            ],
          },
        };
      },
    } as Partial<SerpApiShoppingClient> as SerpApiShoppingClient;

    const result = await discoverLiveTargetCandidates(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag-1-pack-2nd-generation/-/A-85990992",
        target_item_id: "85990992",
        upc_or_gtin: "195950667295",
      },
      { client },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.provider_calls_used).toBe(2);
      expect(result.diagnostics.immersive_enrichment_used).toBe(true);
      expect(result.diagnostics.immersive_offers_count).toBe(0);
      expect(result.diagnostics.rejection_reason_counts).toHaveProperty(
        "non_target_seller",
      );
      expect(JSON.stringify(result.diagnostics)).not.toMatch(
        /api_key|authorization|bearer|serpapi_api_key/i,
      );
    }
  });

  it("keeps the governed query builder shared with monitoring", () => {
    const fp = {
      target_product_url:
        "https://www.target.com/p/apple-airtag-1-pack-2nd-generation/-/A-85990992",
      target_item_id: "85990992",
      product_title: "apple airtag bluetooth tracker",
      seller_kind: "target" as const,
      is_target_plus: false as const,
    };
    expect(buildMonitorShoppingQuery(fp)).toBe(
      "apple airtag bluetooth tracker 85990992 Target",
    );
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
      diagnostics: {
        provider_calls_used: 1,
        shopping_results_count: 1,
        categorized_results_count: 0,
        target_source_results_count: 1,
        immersive_enrichment_used: false,
        immersive_offers_count: 0,
        target_offers_after_enrichment: 1,
        normalized_candidates_count: 1,
        strong_candidates_count: 1,
        rejection_reason_counts: {},
        final_discovery_reason: "single_strong_target_candidate",
        primary_cause: "MATCHING_REJECTED_CORRECTLY",
        query_strategy_identifier: "model_primary",
      },
      created_at: "2026-07-14T00:00:00.000Z",
    });
    const loaded = loadEnrollmentDiscovery(db, "pur_test");
    expect(loaded?.data_source).toBe("LIVE");
    expect(loaded?.evaluation.decision).toBe("EXACT_MATCH_CANDIDATE");
    expect(loaded?.diagnostics?.provider_calls_used).toBe(1);
  });
});
