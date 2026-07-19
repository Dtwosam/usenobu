/**
 * Find-product navigation: purchase id validation, redirect path, error copy.
 */
import { describe, expect, it } from "vitest";
import { buildReviewRedirectPath } from "../../src/web/navigation.js";
import { purchaseFormError } from "../../src/web/error-copy.js";
import {
  exportSnapshot,
  persistDatabaseToCookie,
} from "../../src/web/session-snapshot.js";
import { openDatabase, migrateUp } from "../../src/db/index.js";
import { saveEnrollmentDiscovery } from "../../src/web/discovery-store.js";
import { evaluateProductMatches } from "../../src/matching/index.js";

describe("buildReviewRedirectPath", () => {
  it("builds a valid review path for a real purchase id", () => {
    const qs = new URLSearchParams({ title: "Apple AirTag", source: "LIVE" });
    const path = buildReviewRedirectPath("pur_abcdef012345", qs);
    expect(path).toBe(
      "/purchases/pur_abcdef012345/review?title=Apple+AirTag&source=LIVE",
    );
  });

  it("rejects empty, candidate, or malformed ids", () => {
    const qs = new URLSearchParams();
    expect(buildReviewRedirectPath("", qs)).toBeNull();
    expect(buildReviewRedirectPath("undefined", qs)).toBeNull();
    expect(buildReviewRedirectPath("cand_123", qs)).toBeNull();
    expect(buildReviewRedirectPath("pur_", qs)).toBeNull();
    expect(buildReviewRedirectPath("pur_short", qs)).toBeNull();
  });

  it("never uses candidate ids as purchase paths", () => {
    expect(
      buildReviewRedirectPath("cand_deadbeefcafe", new URLSearchParams()),
    ).toBeNull();
  });
});

describe("purchase form navigation errors", () => {
  it("save_failed uses the locked one-line save message", () => {
    const e = purchaseFormError("save_failed");
    expect(e.body).toBe("Nobu could not save this purchase. Please try again.");
  });

  it("no_reliable_target uses the locked one-line discovery message", () => {
    const e = purchaseFormError("no_reliable_target");
    expect(e.body).toBe(
      "Nobu could not confirm a current Target-sold offer from the third-party shopping results.",
    );
  });
});

describe("session snapshot includes purchase + discovery", () => {
  it("exportSnapshot keeps the purchase id after discovery save", () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const now = new Date().toISOString();
    const purchaseId = "pur_abcdef012345";
    db.prepare(
      `INSERT INTO purchases (
        id, user_ref, target_product_url, purchase_price, currency, purchase_date,
        country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
        is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      purchaseId,
      "demo-user",
      "https://www.target.com/p/apple-airtag/-/A-54191097",
      35,
      "USD",
      "2026-07-14",
      "US",
      "TX",
      "target_online",
      "AirTag",
      "194252096261",
      "54191097",
      0,
      null,
      "MATCH_REVIEW_REQUIRED",
      null,
      "2026-07-28",
      now,
      now,
    );
    const offers = [
      {
        title: "Apple AirTag",
        seller_kind: "target" as const,
        seller_text: "Target",
        is_target_plus: false,
        observed_price: 29.99,
        currency: "USD",
      },
    ];
    const evaluation = evaluateProductMatches(
      {
        target_product_url:
          "https://www.target.com/p/apple-airtag/-/A-54191097",
        model_number: "AirTag",
        product_title: "Apple AirTag",
        target_item_id: "54191097",
      },
      offers,
    );
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "LIVE",
      query: "Apple AirTag Target",
      provider_status: "LIVE_TARGET_MATCH",
      evaluation,
      offers,
      created_at: now,
    });
    const snap = exportSnapshot(db);
    expect(snap.purchases.some((p) => p.id === purchaseId)).toBe(true);
    expect(
      snap.enrollment_discovery?.some((d) => d.purchase_id === purchaseId),
    ).toBe(true);
    // Outside request context, persist is ok (local) without throwing
    return persistDatabaseToCookie(db).then((r) => {
      expect(r.ok).toBe(true);
    });
  });
});
