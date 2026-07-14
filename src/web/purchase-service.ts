import { randomUUID } from "node:crypto";
import { getWebDatabase } from "./db.js";
// Callers that run on Vercel request paths should hydrate via session-snapshot first.
import {
  buildFixtureMonitorOffers,
  buildFixtureOffers,
  FIXTURE_BANNER,
  type FixtureScenario,
} from "./fixtures.js";
import { safeParsePurchaseInput } from "../domain/purchase-input.js";
import { evaluateTargetPolicy } from "../policy/evaluate-target-policy.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  type MatchEvaluationResult,
  type PurchaseMatchReference,
} from "../matching/index.js";
import { runMonitoringPass } from "../monitoring/index.js";
import { TARGET_US_POLICY } from "../policy/target-us-policy.js";
import { addCalendarDays } from "../policy/dates.js";

export interface CreatePurchaseInput {
  target_product_url: string;
  purchase_price: string | number;
  purchase_date: string;
  region?: string;
  model_number?: string;
  target_item_id?: string;
  upc_or_gtin?: string;
  product_title?: string;
  /** Demo fixture scenario — never live. */
  fixture_scenario?: FixtureScenario;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function createPurchaseFlow(raw: CreatePurchaseInput) {
  const db = getWebDatabase();
  const scenario: FixtureScenario = raw.fixture_scenario ?? "exact_match";

  const parsed = safeParsePurchaseInput({
    target_product_url: raw.target_product_url,
    purchase_price: Number(raw.purchase_price),
    currency: "USD",
    purchase_date: raw.purchase_date,
    country: "US",
    region: raw.region || undefined,
    purchase_channel: "target_online",
    model_number: raw.model_number || undefined,
    target_item_id: raw.target_item_id || undefined,
    upc_or_gtin: raw.upc_or_gtin || undefined,
    is_target_plus: false,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      error: "invalid_input",
      details: parsed.error.flatten(),
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const input = parsed.data;
  const policy = evaluateTargetPolicy(
    {
      purchase_channel: input.purchase_channel,
      country: input.country,
      region: input.region,
      purchase_date: input.purchase_date,
      purchase_price: input.purchase_price,
      currency: input.currency,
      is_target_plus: input.is_target_plus,
      has_receipt_or_packing_slip: true,
      has_locked_fingerprint: false,
      evaluated_at: new Date().toISOString(),
    },
    { skip_freshness_check: true },
  );

  if (
    policy.status === "UNSUPPORTED_PURCHASE" ||
    policy.status === "POLICY_EXCLUSION" ||
    policy.status === "WINDOW_EXPIRED"
  ) {
    return {
      ok: false as const,
      error: "unsupported_or_ineligible",
      policy,
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const purchaseId = newId("pur");
  const now = new Date().toISOString();
  const deadline = addCalendarDays(
    input.purchase_date,
    TARGET_US_POLICY.window.days,
  );

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
    input.target_product_url,
    input.purchase_price,
    input.currency,
    input.purchase_date,
    input.country,
    input.region ?? null,
    input.purchase_channel,
    input.model_number ?? null,
    input.upc_or_gtin ?? null,
    input.target_item_id ?? null,
    0,
    null,
    "MATCH_REVIEW_REQUIRED",
    null,
    deadline,
    now,
    now,
  );

  // Optional title stored only in match evaluation context
  const ref: PurchaseMatchReference = {
    purchase_id: purchaseId,
    target_product_url: input.target_product_url,
    target_item_id: input.target_item_id,
    model_number: input.model_number,
    upc_or_gtin: input.upc_or_gtin,
    product_title: raw.product_title,
  };

  const offers = buildFixtureOffers({
    scenario,
    target_product_url: input.target_product_url,
    target_item_id: input.target_item_id,
    model_number: input.model_number,
    product_title: raw.product_title,
  });

  const evaluation: MatchEvaluationResult = evaluateProductMatches(ref, offers);

  return {
    ok: true as const,
    purchase_id: purchaseId,
    purchase: input,
    product_title: raw.product_title ?? null,
    evaluation,
    offers,
    data_source: "FIXTURE" as const,
    fixture_banner: FIXTURE_BANNER,
    policy_window_deadline: deadline,
  };
}

export function getPurchaseDetail(purchaseId: string) {
  const db = getWebDatabase();
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  if (!purchase) return null;

  const fingerprint = purchase.fingerprint_id
    ? (db
        .prepare(
          `SELECT fingerprint_json FROM product_fingerprints WHERE fingerprint_id = ?`,
        )
        .get(purchase.fingerprint_id as string) as
        | { fingerprint_json: string }
        | undefined)
    : undefined;

  const observations = db
    .prepare(
      `SELECT id, observed_price, currency, observed_at, provider_status, product_title, seller_text
       FROM price_observations WHERE purchase_id = ? ORDER BY observed_at DESC`,
    )
    .all(purchaseId) as Array<Record<string, unknown>>;

  const alerts = db
    .prepare(
      `SELECT id, observed_price, purchase_price, potential_recovery, currency, status, created_at, disclaimer
       FROM alerts WHERE purchase_id = ? ORDER BY created_at DESC`,
    )
    .all(purchaseId) as Array<Record<string, unknown>>;

  const runs = db
    .prepare(
      `SELECT id, mode, outcome, skip_reason, searches_consumed, match_result, notes,
              finished_at, started_at, provider_status, alert_id, observation_id
       FROM monitor_runs WHERE purchase_id = ? ORDER BY finished_at DESC LIMIT 20`,
    )
    .all(purchaseId) as Array<Record<string, unknown>>;

  return {
    purchase,
    fingerprint: fingerprint
      ? (JSON.parse(fingerprint.fingerprint_json) as Record<string, unknown>)
      : null,
    observations,
    alerts,
    runs,
    fixture_banner: FIXTURE_BANNER,
    data_source: "FIXTURE" as const,
  };
}

export function confirmPurchaseCandidate(args: {
  purchase_id: string;
  // Candidate payload from review form (fixture-backed)
  candidate_json: string;
}) {
  const db = getWebDatabase();
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(args.purchase_id) as Record<string, unknown> | undefined;
  if (!purchase) {
    return { ok: false as const, error: "not_found" };
  }
  if (purchase.fingerprint_id) {
    return { ok: false as const, error: "already_confirmed" };
  }

  const candidate = JSON.parse(args.candidate_json) as {
    candidate_id: string;
    tier: string;
    decision: string;
    title_only: boolean;
    reasons: string[];
    offer: {
      title: string;
      seller_kind: string;
      seller_text: string;
      is_target_plus: boolean;
      merchant_link?: string;
      link?: string;
      product_link?: string;
      target_item_id?: string;
      model_number?: string;
      upc_or_gtin?: string;
      observed_price?: number;
      currency?: string;
      serpapi_product_id?: string;
    };
    matched_tcin?: string;
    matched_model?: string;
    matched_upc?: string;
    title_similarity: number;
  };

  if (candidate.decision !== "EXACT_MATCH_CANDIDATE" || candidate.title_only) {
    return {
      ok: false as const,
      error: "cannot_confirm_weak_or_ambiguous",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const ref: PurchaseMatchReference = {
    purchase_id: args.purchase_id,
    target_product_url: String(purchase.target_product_url),
    target_item_id: (purchase.target_item_id as string) || null,
    model_number: (purchase.model_number as string) || null,
    upc_or_gtin: (purchase.upc_or_gtin as string) || null,
  };

  try {
    const fp = confirmAndPersistLockedFingerprint({
      db,
      purchase: { ...ref, purchase_id: args.purchase_id },
      candidate: {
        candidate_id: candidate.candidate_id,
        offer: {
          title: candidate.offer.title,
          seller_kind: candidate.offer.seller_kind as "target",
          seller_text: candidate.offer.seller_text,
          is_target_plus: candidate.offer.is_target_plus,
          merchant_link: candidate.offer.merchant_link,
          link: candidate.offer.link,
          product_link: candidate.offer.product_link,
          target_item_id: candidate.offer.target_item_id,
          model_number: candidate.offer.model_number,
          upc_or_gtin: candidate.offer.upc_or_gtin,
          observed_price: candidate.offer.observed_price,
          currency: candidate.offer.currency as "USD" | undefined,
          serpapi_product_id: candidate.offer.serpapi_product_id,
        },
        tier: candidate.tier as
          | "exact_target_url"
          | "exact_tcin"
          | "exact_model_variant"
          | "exact_upc",
        decision: "EXACT_MATCH_CANDIDATE",
        reasons: candidate.reasons,
        title_similarity: candidate.title_similarity,
        title_only: false,
        matched_tcin: candidate.matched_tcin,
        matched_model: candidate.matched_model,
        matched_upc: candidate.matched_upc,
      },
      confirmed_at: new Date().toISOString(),
    });

    return {
      ok: true as const,
      fingerprint_id: fp.fingerprint_id,
      fixture_banner: FIXTURE_BANNER,
    };
  } catch (e) {
    return {
      ok: false as const,
      error: "confirm_failed",
      message: e instanceof Error ? e.message : String(e),
      fixture_banner: FIXTURE_BANNER,
    };
  }
}

export async function runDemoPriceCheck(purchaseId: string) {
  const db = getWebDatabase();
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  if (!purchase) return { ok: false as const, error: "not_found" };
  if (!purchase.fingerprint_id) {
    return { ok: false as const, error: "not_confirmed" };
  }

  const fpRow = db
    .prepare(
      `SELECT fingerprint_json FROM product_fingerprints WHERE fingerprint_id = ?`,
    )
    .get(purchase.fingerprint_id as string) as
    | { fingerprint_json: string }
    | undefined;
  if (!fpRow) return { ok: false as const, error: "missing_fingerprint" };

  const fp = JSON.parse(fpRow.fingerprint_json) as {
    target_product_url: string;
    target_item_id?: string;
    model_number?: string;
    product_title?: string;
  };

  const purchasePrice = Number(purchase.purchase_price);
  const lower = Math.round(purchasePrice * 0.75 * 100) / 100;

  const batch = await runMonitoringPass({
    db,
    mode: "manual",
    as_of: new Date().toISOString(),
    purchase_id: purchaseId,
    fetchObservation: () => ({
      offers: buildFixtureMonitorOffers({
        target_product_url: fp.target_product_url,
        target_item_id: fp.target_item_id,
        model_number: fp.model_number,
        product_title: fp.product_title,
        observed_price: lower,
      }),
      provider_status: "LIVE_TARGET_MATCH",
      consumed_search: true,
      query: "demo-fixture-monitor",
      observed_at: new Date().toISOString(),
      raw_result_hash:
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  });

  return {
    ok: true as const,
    batch,
    fixture_banner: FIXTURE_BANNER,
    data_source: "FIXTURE" as const,
  };
}

export function listPurchases() {
  const db = getWebDatabase();
  return db
    .prepare(
      `SELECT id, target_product_url, purchase_price, currency, purchase_date, status, fingerprint_id, updated_at
       FROM purchases ORDER BY updated_at DESC LIMIT 50`,
    )
    .all() as Array<Record<string, unknown>>;
}

export function getAlert(purchaseId: string, alertId: string) {
  const db = getWebDatabase();
  const alert = db
    .prepare(
      `SELECT * FROM alerts WHERE id = ? AND purchase_id = ?`,
    )
    .get(alertId, purchaseId) as Record<string, unknown> | undefined;
  if (!alert) return null;
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  return {
    alert,
    purchase,
    claim_route: TARGET_US_POLICY.claim_route,
    fixture_banner: FIXTURE_BANNER,
    data_source: "FIXTURE" as const,
    final_decision_by: "Target",
  };
}
