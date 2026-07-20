/**
 * FIXTURE tests — bounded manual check guards (no live SerpApi).
 */
import { afterEach, describe, expect, it } from "vitest";
import { migrateUp, openDatabase } from "../../src/db/index.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchableOffer,
} from "../../src/matching/index.js";
import {
  canOfferManualCheck,
  clearCheckLocks,
  countCompletedProviderChecks,
  hasSearchBudget,
  isCooldownActive,
  MANUAL_CHECK_COOLDOWN_SECONDS,
  releaseCheckLock,
  runBoundedManualCheck,
  tryAcquireCheckLock,
  WEB_DEMO_USER_REF,
} from "../../src/web/manual-check.js";
import {
  checkOutcomeMessage,
  outcomeFromMonitorResult,
} from "../../src/web/check-outcome.js";
import { saveSearchBudget } from "../../src/monitoring/index.js";

const AS_OF = "2026-07-10T12:00:00.000Z";

function seedPurchase(
  db: ReturnType<typeof openDatabase>,
  args?: {
    purchaseId?: string;
    userRef?: string | null;
    status?: string;
    withFingerprint?: boolean;
    price?: number;
  },
): { purchaseId: string; fingerprintId: string | null } {
  const purchaseId = args?.purchaseId ?? "pur-mc-1";
  const price = args?.price ?? 40;
  const userRef =
    args?.userRef === undefined ? WEB_DEMO_USER_REF : args.userRef;

  db.prepare(
    `INSERT INTO purchases (
      id, user_ref, target_product_url, purchase_price, currency, purchase_date,
      country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
      is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    purchaseId,
    userRef,
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
    args?.status ?? "MATCH_REVIEW_REQUIRED",
    null,
    "2026-07-15",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z",
  );

  if (args?.withFingerprint === false) {
    return { purchaseId, fingerprintId: null };
  }

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

describe("checkOutcomeMessage (fixture)", () => {
  it("uses short plain-English outcomes", () => {
    expect(checkOutcomeMessage("no_lower")).toBe("No lower price found.");
    expect(checkOutcomeMessage("price_drop")).toBe(
      "Possible price difference found.",
    );
    expect(checkOutcomeMessage("no_match")).toBe(
      "Nobu could not confirm the exact product.",
    );
    expect(checkOutcomeMessage("cooldown")).toBe(
      "Please wait before checking again.",
    );
    expect(checkOutcomeMessage("window_ended")).toBe(
      "This monitoring window has ended.",
    );
  });

  it("maps monitor results without inventing drops", () => {
    expect(
      outcomeFromMonitorResult({
        match_ok: true,
        alert_created: false,
        potential_recovery: 0,
        notes: ["alert_suppressed_not_lower"],
      }),
    ).toBe("no_lower");
    expect(
      outcomeFromMonitorResult({
        match_ok: false,
        match_reasons: ["ambiguous_candidates"],
      }),
    ).toBe("ambiguous");
    expect(
      outcomeFromMonitorResult({
        match_ok: false,
        match_reasons: ["non_target_seller"],
      }),
    ).toBe("no_match");
    expect(
      outcomeFromMonitorResult({
        provider_status: "PROVIDER_ERROR",
        match_ok: false,
      }),
    ).toBe("provider_unavailable");
  });
});

describe("manual check guards (fixture)", () => {
  afterEach(() => {
    clearCheckLocks();
  });

  it("rejects non-owner without provider call", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db, { withFingerprint: true });
    const before = db
      .prepare(`SELECT COUNT(*) AS c FROM monitor_runs`)
      .get() as { c: number };

    const result = await runBoundedManualCheck({
      db,
      purchase_id: purchaseId,
      user_ref: "other-user",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Cross-user is indistinguishable from missing.
      expect(result.error).toBe("not_found");
      expect(result.provider_called).toBe(false);
    }
    const after = db
      .prepare(`SELECT COUNT(*) AS c FROM monitor_runs`)
      .get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it("rejects unconfirmed purchase without provider call", async () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db, {
      withFingerprint: false,
      status: "MATCH_REVIEW_REQUIRED",
    });

    const result = await runBoundedManualCheck({
      db,
      purchase_id: purchaseId,
      user_ref: WEB_DEMO_USER_REF,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("not_confirmed");
      expect(result.provider_called).toBe(false);
    }
  });

  it("enforces concurrent lock", () => {
    expect(tryAcquireCheckLock("p1")).toBe(true);
    expect(tryAcquireCheckLock("p1")).toBe(false);
    releaseCheckLock("p1");
    expect(tryAcquireCheckLock("p1")).toBe(true);
    clearCheckLocks();
  });

  it("detects cooldown from last manual run", () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    const { purchaseId } = seedPurchase(db, { withFingerprint: true });
    const now = Date.parse(AS_OF);
    db.prepare(
      `INSERT INTO monitor_runs (
        id, purchase_id, mode, outcome, skip_reason, searches_consumed,
        observation_id, alert_id, provider_status, match_result, notes,
        started_at, finished_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      "run_cd",
      purchaseId,
      "manual",
      "checked",
      null,
      1,
      null,
      null,
      "LIVE_TARGET_MATCH",
      "exact",
      null,
      AS_OF,
      AS_OF,
    );

    expect(isCooldownActive(db, purchaseId, now + 5_000)).toBe(true);
    expect(
      isCooldownActive(
        db,
        purchaseId,
        now + (MANUAL_CHECK_COOLDOWN_SECONDS + 1) * 1000,
      ),
    ).toBe(false);
  });

  it("canOfferManualCheck respects fingerprint, status, cooldown, budget", () => {
    expect(
      canOfferManualCheck({
        status: "MONITORING_ACTIVE",
        fingerprint_id: "fp1",
        cooldownActive: false,
        budgetOk: true,
        monitoring_deadline: "2099-12-31",
      }),
    ).toBe(true);
    expect(
      canOfferManualCheck({
        status: "MONITORING_ACTIVE",
        fingerprint_id: null,
        cooldownActive: false,
        budgetOk: true,
      }),
    ).toBe(false);
    expect(
      canOfferManualCheck({
        status: "WINDOW_EXPIRED",
        fingerprint_id: "fp1",
        cooldownActive: false,
        budgetOk: true,
      }),
    ).toBe(false);
    expect(
      canOfferManualCheck({
        status: "MONITORING_ACTIVE",
        fingerprint_id: "fp1",
        cooldownActive: true,
        budgetOk: true,
      }),
    ).toBe(false);
    expect(
      canOfferManualCheck({
        status: "MONITORING_ACTIVE",
        fingerprint_id: "fp1",
        cooldownActive: false,
        budgetOk: false,
      }),
    ).toBe(false);
  });

  it("counts only completed provider checks", () => {
    const runs = [
      { outcome: "checked", searches_consumed: 1, finished_at: "a" },
      { outcome: "skipped", searches_consumed: 0, finished_at: "b" },
      { outcome: "checked", searches_consumed: 0, finished_at: "c" },
      { outcome: "checked", searches_consumed: 2, finished_at: "d" },
    ];
    expect(countCompletedProviderChecks(runs)).toBe(2);
  });

  it("reports budget gate without provider", () => {
    const db = openDatabase(":memory:");
    migrateUp(db);
    expect(hasSearchBudget(db, AS_OF)).toBe(true);
    saveSearchBudget(
      db,
      { period_key: "2026-07", used: 250, limit: 250, remaining: 0 },
      AS_OF,
    );
    expect(hasSearchBudget(db, AS_OF)).toBe(false);
  });
});
