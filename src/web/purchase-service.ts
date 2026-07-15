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
import type { ObservationFetcher } from "../monitoring/types.js";
import { TARGET_US_POLICY } from "../policy/target-us-policy.js";
import { addCalendarDays } from "../policy/dates.js";
import { createLiveSerpApiObservationFetcher } from "./live-monitor.js";
import {
  isFixtureCheckAllowed,
  type ManualCheckDataSource,
} from "./manual-check-mode.js";
import { buildActionCenterModel } from "./action-center.js";
import {
  discoverLiveTargetCandidates,
  resolveDiscoveryDataSource,
} from "./live-discovery.js";
import { saveEnrollmentDiscovery } from "./discovery-store.js";
import {
  isUnusableAfterDemoScrub,
  scrubDemoDefaults,
} from "./demo-defaults.js";
import { evaluateExactIdentity } from "./exact-identity.js";

export interface CreatePurchaseInput {
  target_product_url: string;
  purchase_price: string | number;
  purchase_date: string;
  region?: string;
  model_number?: string;
  target_item_id?: string;
  upc_or_gtin?: string;
  product_title?: string;
  /** Demo fixture scenario — only when fixture discovery gate is open. */
  fixture_scenario?: FixtureScenario;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Create purchase + discover Target product candidates.
 * Production: live SerpApi (never silent fixtures).
 * Tests/e2e with fixture gate: fixture offers only.
 */
export async function createPurchaseFlow(raw: CreatePurchaseInput) {
  const db = getWebDatabase();
  const scenario: FixtureScenario = raw.fixture_scenario ?? "exact_match";
  const discoveryMode = resolveDiscoveryDataSource();

  // Live enrollment: never let pre-repair Example Widget defaults ride through.
  // Fixture gate still uses demo identity intentionally for e2e/demo scenarios.
  let intake: CreatePurchaseInput = raw;
  if (discoveryMode === "LIVE") {
    const scrubbed = scrubDemoDefaults({
      target_product_url: raw.target_product_url,
      target_item_id: raw.target_item_id,
      model_number: raw.model_number,
      product_title: raw.product_title,
      upc_or_gtin: raw.upc_or_gtin,
    });
    if (isUnusableAfterDemoScrub(scrubbed)) {
      return {
        ok: false as const,
        error: "outdated_demo_draft",
        fixture_banner: FIXTURE_BANNER,
      };
    }
    intake = {
      ...raw,
      target_product_url: String(scrubbed.target_product_url ?? ""),
      target_item_id: scrubbed.target_item_id,
      model_number: scrubbed.model_number,
      product_title: scrubbed.product_title,
      upc_or_gtin: scrubbed.upc_or_gtin ?? raw.upc_or_gtin,
    };
  }

  // Consumer Find my product: Target URL + TCIN + (model or UPC). Does not alter A2MCP.
  const identity = evaluateExactIdentity({
    target_product_url: intake.target_product_url,
    target_item_id: intake.target_item_id,
    model_number: intake.model_number,
    upc_or_gtin: intake.upc_or_gtin,
  });
  if (!identity.ok) {
    const status = identity.errors.model_or_upc
      ? "model_or_upc"
      : identity.errors.target_item_id
        ? "tcin"
        : "url";
    return {
      ok: false as const,
      error: "missing_exact_identity",
      status,
      fixture_banner: FIXTURE_BANNER,
    };
  }
  // Prefer explicit TCIN; fill from trusted Target URL when user left TCIN blank.
  if (!intake.target_item_id && identity.effective_tcin) {
    intake = { ...intake, target_item_id: identity.effective_tcin };
  }

  const parsed = safeParsePurchaseInput({
    target_product_url: intake.target_product_url,
    purchase_price: Number(intake.purchase_price),
    currency: "USD",
    purchase_date: intake.purchase_date,
    country: "US",
    region: intake.region || undefined,
    purchase_channel: "target_online",
    model_number: intake.model_number || undefined,
    target_item_id: intake.target_item_id || undefined,
    upc_or_gtin: intake.upc_or_gtin || undefined,
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

  const productTitle = intake.product_title;
  const ref: PurchaseMatchReference = {
    purchase_id: purchaseId,
    target_product_url: input.target_product_url,
    target_item_id: input.target_item_id,
    model_number: input.model_number,
    upc_or_gtin: input.upc_or_gtin,
    product_title: productTitle,
  };

  // --- Discovery: LIVE production vs FIXTURE test/e2e only ---
  if (discoveryMode === "FIXTURE") {
    const offers = buildFixtureOffers({
      scenario,
      target_product_url: input.target_product_url,
      target_item_id: input.target_item_id,
      model_number: input.model_number,
      product_title: productTitle,
    });
    const evaluation: MatchEvaluationResult = evaluateProductMatches(
      ref,
      offers,
    );
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "FIXTURE",
      query: "fixture-discovery",
      provider_status: "FIXTURE",
      evaluation,
      offers,
      created_at: now,
    });
    return {
      ok: true as const,
      purchase_id: purchaseId,
      purchase: input,
      product_title: productTitle ?? null,
      evaluation,
      offers,
      data_source: "FIXTURE" as const,
      fixture_banner: FIXTURE_BANNER,
      policy_window_deadline: deadline,
    };
  }

  const live = await discoverLiveTargetCandidates(ref);
  if (!live.ok) {
    const emptyEval = evaluateProductMatches(ref, []);
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "LIVE",
      query: live.query ?? null,
      provider_status: live.provider_status ?? live.error,
      evaluation: emptyEval,
      offers: [],
      created_at: now,
    });
    return {
      ok: true as const,
      purchase_id: purchaseId,
      purchase: input,
      product_title: productTitle ?? null,
      evaluation: emptyEval,
      offers: [],
      data_source: "LIVE" as const,
      discovery_error: live.error,
      discovery_message: live.message,
      policy_window_deadline: deadline,
    };
  }

  saveEnrollmentDiscovery(db, {
    purchase_id: purchaseId,
    data_source: "LIVE",
    query: live.query,
    provider_status: live.provider_status,
    evaluation: live.evaluation,
    offers: live.offers,
    created_at: now,
  });

  return {
    ok: true as const,
    purchase_id: purchaseId,
    purchase: input,
    product_title: productTitle ?? null,
    evaluation: live.evaluation,
    offers: live.offers,
    data_source: "LIVE" as const,
    discovery_query: live.query,
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
    data_source: resolveDiscoveryDataSource(),
  };
}

export function confirmPurchaseCandidate(args: {
  purchase_id: string;
  /** Candidate payload from review form (live discovery or gated fixtures). */
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

/**
 * Fixture-only manual check. Hard-gated — must not run on production path.
 * Prefer runManualPriceCheck({ data_source: "FIXTURE" }) which enforces the gate.
 */
export async function runDemoPriceCheck(
  purchaseId: string,
  options?: { allow_fixture?: boolean },
) {
  if (!options?.allow_fixture && !isFixtureCheckAllowed()) {
    return {
      ok: false as const,
      error: "fixture_path_denied",
      data_source: "LIVE" as const,
    };
  }

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

/**
 * Live SerpApi manual check — production path.
 * Uses locked fingerprint + runMonitoringPass + live observation fetcher.
 */
export async function runLivePriceCheck(
  purchaseId: string,
  options?: {
    fetchObservation?: ObservationFetcher;
    db?: ReturnType<typeof getWebDatabase>;
  },
) {
  const db = options?.db ?? getWebDatabase();
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

  const fetchObservation =
    options?.fetchObservation ?? createLiveSerpApiObservationFetcher();

  const batch = await runMonitoringPass({
    db,
    mode: "manual",
    as_of: new Date().toISOString(),
    purchase_id: purchaseId,
    fetchObservation,
  });

  return {
    ok: true as const,
    batch,
    data_source: "LIVE" as const,
  };
}

/** Route helper: LIVE or gated FIXTURE — never silent fixture in production. */
export async function runManualPriceCheck(args: {
  purchase_id: string;
  data_source: ManualCheckDataSource;
  fetchObservation?: ObservationFetcher;
  db?: ReturnType<typeof getWebDatabase>;
}) {
  if (args.data_source === "FIXTURE") {
    return runDemoPriceCheck(args.purchase_id, { allow_fixture: true });
  }
  return runLivePriceCheck(args.purchase_id, {
    fetchObservation: args.fetchObservation,
    db: args.db,
  });
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

  const observation = alert.observation_id
    ? (db
        .prepare(`SELECT * FROM price_observations WHERE id = ?`)
        .get(String(alert.observation_id)) as
        | Record<string, unknown>
        | undefined)
    : undefined;

  const fingerprintId =
    (alert.fingerprint_id as string | undefined) ||
    (purchase?.fingerprint_id as string | undefined);
  let fingerprint: Record<string, unknown> | null = null;
  if (fingerprintId) {
    const fpRow = db
      .prepare(
        `SELECT fingerprint_json, target_product_url, target_item_id, product_title, model_number
         FROM product_fingerprints WHERE fingerprint_id = ?`,
      )
      .get(fingerprintId) as
      | {
          fingerprint_json: string;
          target_product_url: string;
          target_item_id: string | null;
          product_title: string | null;
          model_number: string | null;
        }
      | undefined;
    if (fpRow) {
      try {
        fingerprint = {
          ...JSON.parse(fpRow.fingerprint_json),
          target_product_url: fpRow.target_product_url,
          target_item_id: fpRow.target_item_id,
          product_title: fpRow.product_title,
          model_number: fpRow.model_number,
        };
      } catch {
        fingerprint = {
          target_product_url: fpRow.target_product_url,
          target_item_id: fpRow.target_item_id,
          product_title: fpRow.product_title,
          model_number: fpRow.model_number,
        };
      }
    }
  }

  const action = buildActionCenterModel({
    alert,
    purchase,
    observation,
    fingerprint,
  });

  return {
    alert,
    purchase,
    observation: observation ?? null,
    fingerprint,
    action,
    claim_route: {
      ...TARGET_US_POLICY.claim_route,
      contact_url: action.contact_url,
    },
    fixture_banner: action.is_fixture ? FIXTURE_BANNER : null,
    data_source: action.data_source,
    final_decision_by: "Target" as const,
  };
}
