import { randomUUID } from "node:crypto";
import { getWebDatabase } from "./db.js";
// Callers that run on Vercel request paths should hydrate via session-snapshot first.
import {
  buildFixtureMonitorOffers,
  buildFixtureOffers,
  FIXTURE_BANNER,
  resolveFixtureScenario,
  type FixtureScenario,
} from "./fixtures.js";
import { safeParsePurchaseInput } from "../domain/purchase-input.js";
import { evaluateTargetPolicy } from "../policy/evaluate-target-policy.js";
import {
  confirmAndPersistLockedFingerprint,
  evaluateProductMatches,
  evaluateUncertainProductDiscovery,
  isStrongMatchTier,
  MatchDecision,
  offerHasStableIdentity,
  preferredProductUrl,
  type MatchableOffer,
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
import {
  loadEnrollmentDiscovery,
  saveEnrollmentDiscovery,
} from "./discovery-store.js";
import {
  isUnusableAfterDemoScrub,
  scrubDemoDefaults,
} from "./demo-defaults.js";
import {
  evaluateExactIdentity,
  isLikelyTcin,
  provisionalTitleFromTcin,
  provisionalTitleFromTargetUrl,
} from "./exact-identity.js";
import {
  assessProductClues,
  canSubmitFindProduct,
} from "./product-clue.js";
import {
  isTargetComUrl,
  parseTargetProductUrl,
} from "../matching/identity.js";
import {
  consumerOwnsPurchase,
  countQuarantinedPurchases,
  isUsableOwnerRef,
  LEGACY_SHARED_DEMO_OWNER,
  normalizeOwnerRef,
} from "./session-owner.js";

/** @deprecated Lane 7.3A.1 — adaptive flow; retained for test compatibility only. */
export type ProductEntryMode = "exact" | "find";

export interface CreatePurchaseInput {
  target_product_url?: string;
  purchase_price: string | number;
  purchase_date: string;
  region?: string;
  model_number?: string;
  target_item_id?: string;
  upc_or_gtin?: string;
  product_title?: string;
  /** Free-text product title or description (adaptive discovery). */
  product_description?: string;
  color?: string;
  size?: string;
  quantity?: string;
  brand?: string;
  /** @deprecated Ignored — discovery is adaptive from supplied clues. */
  product_entry_mode?: ProductEntryMode;
  /**
   * Demo fixture scenario — only applied when fixture discovery gate is open.
   * Production never depends on client-selected demo flags.
   */
  fixture_scenario?: FixtureScenario;
  /**
   * Ignored if present — ownership is server-assigned only.
   * Kept optional so malicious form posts cannot set it via cast.
   */
  user_ref?: never;
  owner_id?: never;
  owner_ref?: never;
  user_id?: never;
  email?: never;
}

/** Server-assigned owner context for purchase mutations and reads. */
export interface PurchaseOwnerContext {
  owner_ref: string;
}

/**
 * Resolve owner for create. Never trusts client body fields.
 * Unit tests that omit owner_ctx keep the legacy test identity only under Vitest.
 */
function resolveCreateOwner(ownerCtx?: PurchaseOwnerContext): string | null {
  if (ownerCtx) {
    return normalizeOwnerRef(ownerCtx.owner_ref);
  }
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return LEGACY_SHARED_DEMO_OWNER;
  }
  return null;
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export const ENROLLMENT_CANDIDATE_MAX_AGE_MS = 30 * 60 * 1000;

function isFreshEnrollmentCandidate(createdAt: string, now = new Date()): boolean {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= 0 && age <= ENROLLMENT_CANDIDATE_MAX_AGE_MS;
}

export const USER_PROVIDED_PURCHASE_IDENTITY_REASON =
  "user_provided_purchase_identity";

function hasConfirmableCandidate(evaluation: MatchEvaluationResult): boolean {
  const exact = evaluation.exact_candidate;
  return (
    evaluation.decision === MatchDecision.EXACT_MATCH_CANDIDATE &&
    Boolean(exact) &&
    !exact?.title_only &&
    Boolean(exact && isStrongMatchTier(exact.tier))
  );
}

function buildUserProvidedIdentityEvaluation(args: {
  ref: PurchaseMatchReference;
  now: string;
}): { evaluation: MatchEvaluationResult; offers: MatchableOffer[] } {
  const offer: MatchableOffer = {
    offer_id: `user_identity_${newId("offer").replace(/^offer_/, "")}`,
    title:
      args.ref.product_title ||
      (args.ref.target_item_id
        ? `Target item ${args.ref.target_item_id}`
        : "User-confirmed Target product"),
    seller_kind: "target",
    seller_text: "Target (user-provided exact identity)",
    is_target_plus: false,
    merchant_link: args.ref.target_product_url,
    product_link: args.ref.target_product_url,
    link: args.ref.target_product_url,
    target_item_id: args.ref.target_item_id ?? undefined,
    model_number: args.ref.model_number ?? undefined,
    upc_or_gtin: args.ref.upc_or_gtin ?? undefined,
    observed_price: null,
    currency: "USD",
    observed_at: args.now,
  };

  const evaluated = evaluateProductMatches(args.ref, [offer]);
  if (!hasConfirmableCandidate(evaluated)) {
    return { evaluation: evaluated, offers: [offer] };
  }
  const exact = evaluated.exact_candidate!;
  const exactWithSource = {
    ...exact,
    reasons: [USER_PROVIDED_PURCHASE_IDENTITY_REASON, ...exact.reasons],
  };
  return {
    evaluation: {
      ...evaluated,
      reasons: [USER_PROVIDED_PURCHASE_IDENTITY_REASON, ...evaluated.reasons],
      candidates: evaluated.candidates.map((c) =>
        c.candidate_id === exact.candidate_id ? exactWithSource : c,
      ),
      exact_candidate: exactWithSource,
    },
    offers: [offer],
  };
}

function preferUserProvidedIdentityWhenNeeded(args: {
  ref: PurchaseMatchReference;
  now: string;
  evaluation: MatchEvaluationResult;
  offers: MatchableOffer[];
}): { evaluation: MatchEvaluationResult; offers: MatchableOffer[] } {
  if (hasConfirmableCandidate(args.evaluation)) {
    return { evaluation: args.evaluation, offers: args.offers };
  }
  return buildUserProvidedIdentityEvaluation({ ref: args.ref, now: args.now });
}

/** True when purchase already carries exact Target identity (URL/TCIN). */
function purchaseHasExactIdentity(ref: PurchaseMatchReference): boolean {
  if (isLikelyTcin(ref.target_item_id)) return true;
  const url = String(ref.target_product_url ?? "");
  if (url.includes("pending-identity-discovery")) return false;
  return parseTargetProductUrl(url).ok;
}

/**
 * Improve product title from reliable third-party discovery when available.
 * Never uses provider title as a price proof. Preserves link-derived fallback
 * when enrichment is unavailable.
 */
function enrichProductTitle(args: {
  current: string | null | undefined;
  evaluation: MatchEvaluationResult;
  provisional: string | null | undefined;
}): string | null {
  const current = String(args.current ?? "").trim() || null;
  const provisional = String(args.provisional ?? "").trim() || null;
  const exactTitle = args.evaluation.exact_candidate?.offer.title?.trim();
  const strongTitle = args.evaluation.candidates.find(
    (c) =>
      c.decision === MatchDecision.EXACT_MATCH_CANDIDATE &&
      !c.title_only &&
      isStrongMatchTier(c.tier) &&
      c.offer.title?.trim(),
  )?.offer.title?.trim();
  const providerTitle = exactTitle || strongTitle || null;

  // Prefer reliable provider title over link-derived provisional
  if (providerTitle) {
    const isProvisional =
      !current ||
      current === provisional ||
      /^Target item \d+$/i.test(current) ||
      (provisional != null &&
        current.toLowerCase() === provisional.toLowerCase());
    if (isProvisional || !current) return providerTitle;
  }
  return current || provisional || providerTitle;
}

const PENDING_DISCOVERY_URL =
  "https://www.target.com/p/pending-identity-discovery";

/**
 * Create purchase + discover Target product candidates (adaptive).
 * Production: live SerpApi (never silent fixtures).
 * Tests/e2e with fixture gate: fixture offers only.
 *
 * User supplies whatever clues they have. Nobu resolves:
 * - one high-confidence candidate (exact identity evidence),
 * - several plausible Target candidates, or
 * - insufficient / no useful results.
 */
export async function createPurchaseFlow(
  raw: CreatePurchaseInput,
  ownerCtx?: PurchaseOwnerContext,
) {
  const db = getWebDatabase();
  const ownerRef = resolveCreateOwner(ownerCtx);
  if (!ownerRef) {
    return {
      ok: false as const,
      error: "unauthorized",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const discoveryMode = resolveDiscoveryDataSource();
  // Fixture scenario only when gate is open — never from production UI flags
  const scenario: FixtureScenario =
    discoveryMode === "FIXTURE"
      ? resolveFixtureScenario(raw.fixture_scenario)
      : "exact_match";

  // Live enrollment: never let pre-repair Example Widget defaults ride through.
  // Fixture gate still uses demo identity intentionally for e2e/demo scenarios.
  // Strip any client ownership fields (typed as never; defend against casts).
  const {
    user_ref: _ignoreUser,
    owner_id: _ignoreOwnerId,
    owner_ref: _ignoreOwnerRef,
    user_id: _ignoreUserId,
    email: _ignoreEmail,
    ...safeRaw
  } = raw as CreatePurchaseInput & Record<string, unknown>;
  void _ignoreUser;
  void _ignoreOwnerId;
  void _ignoreOwnerRef;
  void _ignoreUserId;
  void _ignoreEmail;
  let intake: CreatePurchaseInput = safeRaw;
  if (discoveryMode === "LIVE") {
    const scrubbed = scrubDemoDefaults({
      target_product_url: raw.target_product_url,
      target_item_id: raw.target_item_id,
      model_number: raw.model_number,
      product_title: raw.product_title || raw.product_description,
      upc_or_gtin: raw.upc_or_gtin,
    });
    // Only treat as outdated demo when the scrub left zero usable clues
    const afterScrubClues = assessProductClues({
      target_product_url: scrubbed.target_product_url,
      target_item_id: scrubbed.target_item_id,
      model_number: scrubbed.model_number,
      product_title: scrubbed.product_title,
      upc_or_gtin: scrubbed.upc_or_gtin,
    });
    if (
      isUnusableAfterDemoScrub(scrubbed) &&
      !afterScrubClues.has_usable_clue
    ) {
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

  // Server-side gate: price, date, and at least one usable product clue
  const gate = canSubmitFindProduct({
    purchase_price: intake.purchase_price,
    purchase_date: intake.purchase_date,
    region: intake.region,
    clues: {
      product_title: intake.product_title,
      product_description: intake.product_description,
      target_product_url: intake.target_product_url,
      target_item_id: intake.target_item_id,
      model_number: intake.model_number,
      upc_or_gtin: intake.upc_or_gtin,
    },
  });
  if (!gate.ok) {
    return {
      ok: false as const,
      error: "insufficient_product_clue",
      status: "clue",
      message: gate.reason,
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const clues = assessProductClues({
    product_title: intake.product_title,
    product_description: intake.product_description,
    target_product_url: intake.target_product_url,
    target_item_id: intake.target_item_id,
    model_number: intake.model_number,
    upc_or_gtin: intake.upc_or_gtin,
  });

  let productTitle: string | null | undefined =
    intake.product_title || intake.product_description || clues.description || undefined;
  let provisionalTitle: string | null = null;
  let storedUrl: string;
  let storedTcin: string | undefined;

  if (clues.has_exact_identity) {
    const identity = evaluateExactIdentity({
      target_product_url: intake.target_product_url,
      target_item_id: intake.target_item_id,
      model_number: intake.model_number,
      upc_or_gtin: intake.upc_or_gtin,
    });
    if (!identity.ok || !identity.effective_url || !identity.effective_tcin) {
      return {
        ok: false as const,
        error: "missing_exact_identity",
        status: identity.errors.target_item_id
          ? "tcin"
          : identity.errors.target_product_url
            ? "INVALID_TARGET_URL"
            : "identity",
        identity_errors: identity.errors,
        fixture_banner: FIXTURE_BANNER,
      };
    }
    storedUrl = identity.effective_url;
    storedTcin = identity.effective_tcin;
    provisionalTitle =
      identity.provisional_title ||
      provisionalTitleFromTargetUrl(intake.target_product_url) ||
      provisionalTitleFromTcin(storedTcin);
    if (!productTitle) productTitle = provisionalTitle;
    intake = {
      ...intake,
      target_product_url: storedUrl,
      target_item_id: storedTcin,
      product_title: productTitle || undefined,
    };
  } else {
    // Soft clues only (description / model / UPC) — pending URL until confirm
    productTitle =
      productTitle ||
      clues.description ||
      (intake.model_number ? `Model ${intake.model_number}` : undefined) ||
      (intake.upc_or_gtin ? `UPC ${intake.upc_or_gtin}` : undefined);
    provisionalTitle = productTitle || null;
    storedUrl = PENDING_DISCOVERY_URL;
    storedTcin = undefined;
    intake = {
      ...intake,
      target_product_url: storedUrl,
      target_item_id: storedTcin,
      product_title: productTitle || undefined,
    };
  }

  const parsed = safeParsePurchaseInput({
    target_product_url: storedUrl,
    purchase_price: Number(intake.purchase_price),
    currency: "USD",
    purchase_date: intake.purchase_date,
    country: "US",
    region: intake.region || undefined,
    purchase_channel: "target_online",
    model_number: intake.model_number || undefined,
    target_item_id: storedTcin || undefined,
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
    ownerRef,
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

  const ref: PurchaseMatchReference = {
    purchase_id: purchaseId,
    target_product_url: input.target_product_url,
    target_item_id: input.target_item_id,
    model_number: input.model_number,
    upc_or_gtin: input.upc_or_gtin,
    product_title: productTitle,
    brand: intake.brand || undefined,
    color: intake.color || undefined,
    size: intake.size || undefined,
    quantity: intake.quantity || undefined,
  };

  // Adaptive: multi-candidate presentation when no strong purchase identity
  const useMultiCandidateDiscovery = !purchaseHasExactIdentity(ref);

  // --- Discovery: LIVE production vs FIXTURE test/e2e only ---
  if (discoveryMode === "FIXTURE") {
    // Prefer multi_candidate fixtures when identity is soft and scenario default
    const fixtureScenario: FixtureScenario =
      useMultiCandidateDiscovery && scenario === "exact_match"
        ? "multi_candidate"
        : scenario;
    const offers = buildFixtureOffers({
      scenario: fixtureScenario,
      target_product_url: input.target_product_url,
      target_item_id: input.target_item_id,
      model_number: input.model_number,
      product_title: productTitle || undefined,
    });
    const evaluation: MatchEvaluationResult = useMultiCandidateDiscovery
      ? evaluateUncertainProductDiscovery(ref, offers)
      : evaluateProductMatches(ref, offers);
    const enrichedTitle = enrichProductTitle({
      current: productTitle,
      evaluation,
      provisional: provisionalTitle,
    });
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "FIXTURE",
      query: useMultiCandidateDiscovery
        ? "fixture-adaptive-discovery"
        : "fixture-discovery",
      provider_status: "FIXTURE",
      evaluation,
      offers,
      created_at: now,
    });
    return {
      ok: true as const,
      purchase_id: purchaseId,
      purchase: input,
      product_title: enrichedTitle,
      evaluation,
      offers,
      data_source: "FIXTURE" as const,
      discovery_kind: useMultiCandidateDiscovery
        ? ("multi_candidate" as const)
        : ("exact_identity" as const),
      fixture_banner: FIXTURE_BANNER,
      policy_window_deadline: deadline,
    };
  }

  const live = await discoverLiveTargetCandidates(ref);
  if (!live.ok) {
    if (useMultiCandidateDiscovery) {
      // Soft clues without provider results — empty candidate list (no-results)
      const emptyEval = evaluateUncertainProductDiscovery(ref, []);
      saveEnrollmentDiscovery(db, {
        purchase_id: purchaseId,
        data_source: "LIVE",
        query: live.query ?? null,
        provider_status: live.provider_status ?? live.error,
        evaluation: emptyEval,
        offers: [],
        diagnostics: live.diagnostics ?? null,
        created_at: now,
      });
      return {
        ok: true as const,
        purchase_id: purchaseId,
        purchase: input,
        product_title: productTitle ?? null,
        evaluation: emptyEval,
        offers: [] as MatchableOffer[],
        data_source: "LIVE" as const,
        discovery_kind: "no_results" as const,
        discovery_error: live.error,
        discovery_message: live.message,
        policy_window_deadline: deadline,
      };
    }
    // Strong user identity: fall back to user-provided identity candidate
    const identityDiscovery = buildUserProvidedIdentityEvaluation({
      ref: {
        ...ref,
        product_title:
          productTitle ||
          provisionalTitle ||
          (storedTcin ? `Target item ${storedTcin}` : ref.product_title),
      },
      now,
    });
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "LIVE",
      query: live.query ?? null,
      provider_status: live.provider_status ?? live.error,
      evaluation: identityDiscovery.evaluation,
      offers: identityDiscovery.offers,
      diagnostics: live.diagnostics ?? null,
      created_at: now,
    });
    return {
      ok: true as const,
      purchase_id: purchaseId,
      purchase: input,
      product_title: productTitle || provisionalTitle || null,
      evaluation: identityDiscovery.evaluation,
      offers: identityDiscovery.offers,
      data_source: "LIVE" as const,
      discovery_kind: "exact_identity" as const,
      discovery_error: live.error,
      discovery_message: live.message,
      policy_window_deadline: deadline,
    };
  }

  if (useMultiCandidateDiscovery) {
    const evaluation = evaluateUncertainProductDiscovery(ref, live.offers);
    const enrichedTitle = enrichProductTitle({
      current: productTitle,
      evaluation,
      provisional: provisionalTitle,
    });
    saveEnrollmentDiscovery(db, {
      purchase_id: purchaseId,
      data_source: "LIVE",
      query: live.query,
      provider_status: live.provider_status,
      evaluation,
      offers: live.offers,
      diagnostics: live.diagnostics,
      created_at: now,
    });
    return {
      ok: true as const,
      purchase_id: purchaseId,
      purchase: input,
      product_title: enrichedTitle,
      evaluation,
      offers: live.offers,
      data_source: "LIVE" as const,
      discovery_kind:
        evaluation.candidates.length === 0
          ? ("no_results" as const)
          : evaluation.exact_candidate
            ? ("single" as const)
            : ("multi_candidate" as const),
      discovery_query: live.query,
      policy_window_deadline: deadline,
    };
  }

  const discovery = preferUserProvidedIdentityWhenNeeded({
    ref: {
      ...ref,
      product_title:
        productTitle ||
        provisionalTitle ||
        (storedTcin ? `Target item ${storedTcin}` : ref.product_title),
    },
    now,
    evaluation: live.evaluation,
    offers: live.offers,
  });
  const enrichedTitle = enrichProductTitle({
    current: productTitle,
    evaluation: discovery.evaluation,
    provisional: provisionalTitle,
  });

  saveEnrollmentDiscovery(db, {
    purchase_id: purchaseId,
    data_source: "LIVE",
    query: live.query,
    provider_status: live.provider_status,
    evaluation: discovery.evaluation,
    offers: discovery.offers,
    diagnostics: live.diagnostics,
    created_at: now,
  });

  return {
    ok: true as const,
    purchase_id: purchaseId,
    purchase: input,
    product_title: enrichedTitle,
    evaluation: discovery.evaluation,
    offers: discovery.offers,
    data_source: "LIVE" as const,
    discovery_kind: "exact_identity" as const,
    discovery_query: live.query,
    policy_window_deadline: deadline,
  };
}

/**
 * Load purchase detail.
 * Consumer paths must pass owner_ref — missing/cross-user/quarantined → null.
 * Internal paths (A2MCP agent) may omit owner_ref; never expose via consumer UI.
 */
export function getPurchaseDetail(
  purchaseId: string,
  ownerCtx?: PurchaseOwnerContext,
) {
  const db = getWebDatabase();
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  if (!purchase) return null;

  if (ownerCtx) {
    if (
      !consumerOwnsPurchase(
        purchase.user_ref as string | null | undefined,
        ownerCtx.owner_ref,
      )
    ) {
      return null;
    }
  }

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
  /** Candidate id from the server-stored enrollment discovery snapshot. */
  candidate_id: string;
  /** Server-assigned session owner (required for consumer path). */
  owner_ref?: string;
  now?: Date;
}) {
  const db = getWebDatabase();
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(args.purchase_id) as Record<string, unknown> | undefined;
  if (!purchase) {
    return { ok: false as const, error: "not_found" };
  }
  // When owner_ref provided (consumer), enforce ownership. Unit tests may omit.
  if (args.owner_ref !== undefined) {
    if (
      !consumerOwnsPurchase(
        purchase.user_ref as string | null | undefined,
        args.owner_ref,
      )
    ) {
      return { ok: false as const, error: "not_found" };
    }
  } else if (
    process.env.VITEST !== "true" &&
    process.env.NODE_ENV !== "test"
  ) {
    return { ok: false as const, error: "not_found" };
  }
  if (purchase.fingerprint_id) {
    return { ok: false as const, error: "already_confirmed" };
  }

  const candidateId = String(args.candidate_id || "").trim();
  if (!/^cand_[a-zA-Z0-9_-]{8,80}$/.test(candidateId)) {
    return {
      ok: false as const,
      error: "tampered_candidate",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const discovery = loadEnrollmentDiscovery(db, args.purchase_id);
  if (!discovery) {
    return {
      ok: false as const,
      error: "missing_candidate_snapshot",
      fixture_banner: FIXTURE_BANNER,
    };
  }
  if (!isFreshEnrollmentCandidate(discovery.created_at, args.now ?? new Date())) {
    return {
      ok: false as const,
      error: "stale_candidate",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  const baseRef: PurchaseMatchReference = {
    purchase_id: args.purchase_id,
    target_product_url: String(purchase.target_product_url),
    target_item_id: (purchase.target_item_id as string) || null,
    model_number: (purchase.model_number as string) || null,
    upc_or_gtin: (purchase.upc_or_gtin as string) || null,
  };

  const hasExactPurchase = purchaseHasExactIdentity(baseRef);

  // Prefer snapshot evaluation (preserves multi-candidate offer_ids), then
  // revalidate the selected offer server-side.
  const fromSnap = discovery.evaluation.candidates.find(
    (c) => c.candidate_id === candidateId,
  );
  const offerFromSnap =
    fromSnap?.offer ||
    discovery.offers.find((o) => {
      const oid = o.offer_id ? `cand_${o.offer_id}` : "";
      return oid === candidateId;
    });

  if (!offerFromSnap) {
    return {
      ok: false as const,
      error: "tampered_candidate",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  // Reject non-Target / Target Plus / weak before re-score
  if (
    offerFromSnap.is_target_plus ||
    offerFromSnap.seller_kind !== "target"
  ) {
    return {
      ok: false as const,
      error: "cannot_confirm_weak_or_ambiguous",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  // Title-only or missing stable identity cannot lock
  if (fromSnap?.title_only || !offerHasStableIdentity(offerFromSnap)) {
    return {
      ok: false as const,
      error: "cannot_confirm_weak_or_ambiguous",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  // Build confirmation ref: exact purchase identity when present; otherwise
  // bind to the selected offer's Target identity (uncertain mode).
  const offerUrlRaw = preferredProductUrl(offerFromSnap);
  const offerUrl = isTargetComUrl(offerUrlRaw) ? offerUrlRaw : null;
  let resolvedOfferTcin: string | null =
    String(offerFromSnap.target_item_id ?? "").trim() || null;
  if (!resolvedOfferTcin && offerUrl) {
    const p = parseTargetProductUrl(offerUrl);
    if (p.ok) resolvedOfferTcin = p.tcin;
  }

  const confirmRef: PurchaseMatchReference = hasExactPurchase
    ? baseRef
    : {
        ...baseRef,
        target_product_url:
          (offerUrl && isTargetComUrl(offerUrl)
            ? offerUrl
            : baseRef.target_product_url) || PENDING_DISCOVERY_URL,
        target_item_id: resolvedOfferTcin || baseRef.target_item_id,
        model_number:
          offerFromSnap.model_number || baseRef.model_number || null,
        upc_or_gtin: offerFromSnap.upc_or_gtin || baseRef.upc_or_gtin || null,
        product_title: offerFromSnap.title || null,
      };

  // Revalidate selected offer only (fail closed if identity no longer strong)
  const revalidated = hasExactPurchase
    ? evaluateProductMatches(confirmRef, [offerFromSnap])
    : evaluateUncertainProductDiscovery(confirmRef, [offerFromSnap]);

  const candidate =
    revalidated.candidates.find((c) => c.candidate_id === candidateId) ||
    revalidated.exact_candidate ||
    revalidated.candidates.find(
      (c) =>
        c.offer.offer_id &&
        offerFromSnap.offer_id &&
        c.offer.offer_id === offerFromSnap.offer_id,
    );

  if (!candidate) {
    return {
      ok: false as const,
      error: "tampered_candidate",
      fixture_banner: FIXTURE_BANNER,
    };
  }
  if (
    candidate.decision !== "EXACT_MATCH_CANDIDATE" ||
    candidate.title_only ||
    !isStrongMatchTier(candidate.tier)
  ) {
    return {
      ok: false as const,
      error: "cannot_confirm_weak_or_ambiguous",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  // For exact-mode multi-strong, ensure revalidation still yields a single exact
  if (hasExactPurchase) {
    const selectedOnly = evaluateProductMatches(confirmRef, [candidate.offer]);
    if (
      selectedOnly.decision !== "EXACT_MATCH_CANDIDATE" ||
      !selectedOnly.exact_candidate
    ) {
      return {
        ok: false as const,
        error: "ambiguous_selection",
        fixture_banner: FIXTURE_BANNER,
      };
    }
  }

  // Ensure Target.com URL for fingerprint lock (synthesize from TCIN if needed)
  let lockUrl = preferredProductUrl(candidate.offer);
  if (!isTargetComUrl(lockUrl) && resolvedOfferTcin) {
    lockUrl = `https://www.target.com/p/-/A-${resolvedOfferTcin}`;
  }
  if (!isTargetComUrl(lockUrl) && isTargetComUrl(confirmRef.target_product_url)) {
    lockUrl = confirmRef.target_product_url;
  }
  if (!isTargetComUrl(lockUrl)) {
    return {
      ok: false as const,
      error: "cannot_confirm_weak_or_ambiguous",
      fixture_banner: FIXTURE_BANNER,
    };
  }

  // Update purchase identity from confirmed candidate (uncertain mode)
  if (!hasExactPurchase) {
    db.prepare(
      `UPDATE purchases SET target_product_url = ?, target_item_id = ?,
       model_number = COALESCE(?, model_number),
       upc_or_gtin = COALESCE(?, upc_or_gtin),
       updated_at = ? WHERE id = ?`,
    ).run(
      lockUrl,
      resolvedOfferTcin,
      candidate.offer.model_number ?? null,
      candidate.offer.upc_or_gtin ?? null,
      (args.now ?? new Date()).toISOString(),
      args.purchase_id,
    );
  }

  try {
    const fp = confirmAndPersistLockedFingerprint({
      db,
      purchase: {
        ...confirmRef,
        purchase_id: args.purchase_id,
        target_product_url: lockUrl,
        target_item_id: resolvedOfferTcin || confirmRef.target_item_id,
      },
      candidate: {
        ...candidate,
        offer: {
          ...candidate.offer,
          merchant_link: lockUrl,
          target_item_id:
            resolvedOfferTcin || candidate.offer.target_item_id,
        },
      },
      confirmed_at: (args.now ?? new Date()).toISOString(),
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
    now?: Date;
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
    as_of: (options?.now ?? new Date()).toISOString(),
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
  now?: Date;
}) {
  if (args.data_source === "FIXTURE") {
    return runDemoPriceCheck(args.purchase_id, { allow_fixture: true });
  }
  return runLivePriceCheck(args.purchase_id, {
    fetchObservation: args.fetchObservation,
    db: args.db,
    now: args.now,
  });
}

/**
 * List purchases for one server-assigned owner only.
 * Never returns a global list. Ownerless/legacy shared rows are excluded.
 */
export function listPurchases(ownerCtx: PurchaseOwnerContext) {
  const db = getWebDatabase();
  const owner = normalizeOwnerRef(ownerCtx.owner_ref);
  if (!owner || !isUsableOwnerRef(owner)) {
    return [] as Array<Record<string, unknown>>;
  }
  // Explicit owner match — quarantined rows (null / demo-user) never match usr_* sessions.
  return db
    .prepare(
      `SELECT id, target_product_url, purchase_price, currency, purchase_date, status, fingerprint_id, updated_at
       FROM purchases
       WHERE user_ref = ?
       ORDER BY updated_at DESC LIMIT 50`,
    )
    .all(owner) as Array<Record<string, unknown>>;
}

/** Redacted quarantine report (ops only — not a consumer API). */
export function getQuarantinedPurchaseCount() {
  return countQuarantinedPurchases(getWebDatabase());
}

export function getAlert(
  purchaseId: string,
  alertId: string,
  ownerCtx?: PurchaseOwnerContext,
) {
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
  if (!purchase) return null;
  if (ownerCtx) {
    if (
      !consumerOwnsPurchase(
        purchase.user_ref as string | null | undefined,
        ownerCtx.owner_ref,
      )
    ) {
      return null;
    }
  } else if (
    process.env.VITEST !== "true" &&
    process.env.NODE_ENV !== "test"
  ) {
    // Consumer must always pass owner; internal callers only in tests without ctx.
    return null;
  }

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
