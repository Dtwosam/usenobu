/**
 * Lane 7.4C — free agent-native discovery, confirmation, and monitoring preflight.
 *
 * Reuses existing matching (discovery-candidates/confirm), policy evaluation,
 * and Lane 7.4B connection authorization — no parallel implementation.
 * discovery_sessions are unauthenticated and expiring; no durable owned
 * purchase or private monitoring state exists before PREFLIGHT_MONITORING.
 */
import { randomUUID } from "node:crypto";
import { getWebDatabase } from "./db.js";
import type { NobuDatabase } from "../db/index.js";
import {
  confirmAndPersistLockedFingerprintPending,
  confirmProductMatch,
  evaluateUncertainProductDiscovery,
  isStrongMatchTier,
  MatchDecision,
  type MatchableOffer,
  type PurchaseMatchReference,
  type ScoredCandidate,
} from "../matching/index.js";
import { evaluateTargetPolicy } from "../policy/evaluate-target-policy.js";
import { TARGET_US_POLICY } from "../policy/target-us-policy.js";
import { addCalendarDays } from "../policy/dates.js";
import { discoverLiveTargetCandidates } from "./live-discovery.js";
import type { NormalizedShoppingOffer } from "../serpapi/types.js";
import { evaluateExactIdentity } from "./exact-identity.js";
import { assessProductClues, canSubmitFindProduct } from "./product-clue.js";
import { purchaseHasExactIdentity, PENDING_DISCOVERY_URL } from "./purchase-service.js";
import { persistAccountPurchaseIfNeeded } from "../auth/service.js";
import {
  getAuthStore,
  isAccountOwnerRef,
  type AuthStore,
  type DiscoverySessionRow,
} from "../auth/auth-store.js";
import { authorizeAgentConnection } from "../auth/agent-connections.js";
import { sha256Hex } from "../auth/crypto.js";
import type { DiscoveryPurchaseFields } from "../ai/schemas.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

const DISCOVERY_SESSION_TTL_MS = 30 * 60 * 1000;
const QUOTE_TTL_MS = 15 * 60 * 1000;
export const MONITORING_ENROLLMENT_PRICE_USD = 0.99;

const FAIL_CLOSED_POLICY_STATUSES = new Set([
  "UNSUPPORTED_PURCHASE",
  "POLICY_EXCLUSION",
  "WINDOW_EXPIRED",
  "POLICY_STALE",
]);

function newPurchaseId(): string {
  return `pur_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

function isFreshSession(session: DiscoverySessionRow, now: Date): boolean {
  const t = Date.parse(session.expires_at);
  return Number.isFinite(t) && now.getTime() <= t;
}

/** Minimal, safe candidate summary — never leaks raw SerpApi payload. */
function summarizeCandidate(c: ScoredCandidate) {
  return {
    candidate_id: c.candidate_id,
    title: c.offer.title,
    target_item_id: c.offer.target_item_id ?? c.matched_tcin ?? null,
    model_number: c.offer.model_number ?? c.matched_model ?? null,
    upc_or_gtin: c.offer.upc_or_gtin ?? c.matched_upc ?? null,
    target_product_url:
      c.offer.merchant_link ?? c.offer.link ?? c.offer.product_link ?? null,
    observed_price: c.offer.observed_price ?? null,
    currency: c.offer.currency ?? null,
    confirmable:
      c.decision === MatchDecision.EXACT_MATCH_CANDIDATE &&
      !c.title_only &&
      isStrongMatchTier(c.tier),
  };
}

export interface AgentDiscoveryDeps {
  /** Inject offers for tests — bypasses live SerpApi entirely. */
  offersOverride?: MatchableOffer[] | NormalizedShoppingOffer[];
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
}

export type DiscoverProductResult =
  | {
      ok: true;
      status: "PRODUCT_CONFIRMATION_REQUIRED" | "MORE_INFORMATION_REQUIRED";
      discovery_session_id: string;
      discovery_session_expires_at: string;
      candidates: ReturnType<typeof summarizeCandidate>[];
    }
  | { ok: false; error: "insufficient_product_clue"; message: string };

/**
 * DISCOVER_PRODUCT — no connection required. Never creates a durable owned
 * purchase or exposes private monitoring state.
 */
export async function discoverProductForAgent(
  purchase: DiscoveryPurchaseFields,
  deps: AgentDiscoveryDeps = {},
): Promise<DiscoverProductResult> {
  const gate = canSubmitFindProduct({
    purchase_price: purchase.purchase_price,
    purchase_date: purchase.purchase_date,
    region: purchase.region,
    clues: {
      product_title: purchase.product_title,
      product_description: purchase.product_description,
      target_product_url: purchase.target_product_url,
      target_item_id: purchase.target_item_id,
      model_number: purchase.model_number,
      upc_or_gtin: purchase.upc_or_gtin,
    },
  });
  if (!gate.ok) {
    return { ok: false, error: "insufficient_product_clue", message: gate.reason };
  }

  const clues = assessProductClues({
    product_title: purchase.product_title,
    product_description: purchase.product_description,
    target_product_url: purchase.target_product_url,
    target_item_id: purchase.target_item_id,
    model_number: purchase.model_number,
    upc_or_gtin: purchase.upc_or_gtin,
  });

  let targetUrl: string;
  let targetTcin: string | undefined;
  const productTitle =
    purchase.product_title || purchase.product_description || clues.description || undefined;

  if (clues.has_exact_identity) {
    const identity = evaluateExactIdentity({
      target_product_url: purchase.target_product_url,
      target_item_id: purchase.target_item_id,
      model_number: purchase.model_number,
      upc_or_gtin: purchase.upc_or_gtin,
    });
    targetUrl = identity.effective_url || PENDING_DISCOVERY_URL;
    targetTcin = identity.effective_tcin || undefined;
  } else {
    targetUrl = PENDING_DISCOVERY_URL;
    targetTcin = undefined;
  }

  const ref: PurchaseMatchReference = {
    target_product_url: targetUrl,
    target_item_id: targetTcin,
    model_number: purchase.model_number,
    upc_or_gtin: purchase.upc_or_gtin,
    product_title: productTitle,
    brand: purchase.brand,
    size: purchase.size,
    color: purchase.color,
    quantity: purchase.quantity,
  };

  let offers: MatchableOffer[] | NormalizedShoppingOffer[];
  if (deps.offersOverride) {
    offers = deps.offersOverride;
  } else {
    const live = await discoverLiveTargetCandidates(ref);
    offers = live.ok ? live.offers : [];
  }

  const evaluation = evaluateUncertainProductDiscovery(ref, offers);

  const now = deps.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + DISCOVERY_SESSION_TTL_MS).toISOString();

  const structuredSnapshot = {
    purchase_price: purchase.purchase_price,
    purchase_date: purchase.purchase_date,
    purchase_channel: purchase.purchase_channel,
    country: purchase.country,
    region: purchase.region ?? null,
    product_title: productTitle ?? null,
    target_product_url: targetUrl,
    target_item_id: targetTcin ?? null,
    model_number: purchase.model_number ?? null,
    upc_or_gtin: purchase.upc_or_gtin ?? null,
    brand: purchase.brand ?? null,
    size: purchase.size ?? null,
    color: purchase.color ?? null,
    quantity: purchase.quantity ?? null,
  };

  const store = await resolveStore(deps.sqliteDb, deps.env);
  const session = await store.insertDiscoverySession({
    structuredSnapshotJson: JSON.stringify(structuredSnapshot),
    purchaseTextHash: null,
    candidatesSnapshotJson: JSON.stringify(evaluation.candidates),
    now,
    ttlMs: DISCOVERY_SESSION_TTL_MS,
  });
  void nowIso;
  void expiresAt;

  const candidates = evaluation.candidates.map(summarizeCandidate);

  return {
    ok: true,
    status:
      candidates.length > 0
        ? "PRODUCT_CONFIRMATION_REQUIRED"
        : "MORE_INFORMATION_REQUIRED",
    discovery_session_id: session.id,
    discovery_session_expires_at: session.expires_at,
    candidates,
  };
}

export type ConfirmProductResult =
  | {
      ok: true;
      status: "PRODUCT_CONFIRMED";
      discovery_session_id: string;
      target_product_url: string;
      target_item_id: string | null;
      model_number: string | null;
      upc_or_gtin: string | null;
    }
  | { ok: false; status: "CONNECTION_EXPIRED"; http_status: 404 }
  | { ok: false; status: "CANDIDATE_NOT_CONFIRMABLE"; http_status: 400 };

/**
 * CONFIRM_PRODUCT — no connection required. Locks a fingerprint against the
 * discovery session only; still creates no durable owned purchase.
 */
export async function confirmProductForAgent(args: {
  discoverySessionId: string;
  candidateId: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
}): Promise<ConfirmProductResult> {
  const store = await resolveStore(args.sqliteDb, args.env);
  const now = args.now ?? new Date();

  const session = await store.getDiscoverySessionById(args.discoverySessionId);
  if (
    !session ||
    !isFreshSession(session, now) ||
    !(session.status === "discovering" || session.status === "confirmed")
  ) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  let candidates: ScoredCandidate[];
  try {
    candidates = JSON.parse(
      session.candidates_snapshot_json || "[]",
    ) as ScoredCandidate[];
  } catch {
    return { ok: false, status: "CANDIDATE_NOT_CONFIRMABLE", http_status: 400 };
  }

  const candidate = candidates.find((c) => c.candidate_id === args.candidateId);
  if (!candidate) {
    return { ok: false, status: "CANDIDATE_NOT_CONFIRMABLE", http_status: 400 };
  }
  if (
    candidate.offer.is_target_plus ||
    candidate.offer.seller_kind !== "target" ||
    candidate.title_only ||
    candidate.decision !== MatchDecision.EXACT_MATCH_CANDIDATE ||
    !isStrongMatchTier(candidate.tier)
  ) {
    return { ok: false, status: "CANDIDATE_NOT_CONFIRMABLE", http_status: 400 };
  }

  const snapshot = JSON.parse(session.structured_snapshot_json) as {
    target_product_url: string;
    target_item_id: string | null;
    model_number: string | null;
    upc_or_gtin: string | null;
    product_title: string | null;
  };

  const ref: PurchaseMatchReference = {
    purchase_id: session.id,
    target_product_url: snapshot.target_product_url,
    target_item_id: snapshot.target_item_id ?? undefined,
    model_number: snapshot.model_number ?? undefined,
    upc_or_gtin: snapshot.upc_or_gtin ?? undefined,
    product_title: snapshot.product_title ?? undefined,
  };

  let confirmed;
  try {
    confirmed = confirmProductMatch({
      purchase: ref,
      candidate,
      confirmed_by_user: true,
      confirmed_at: now.toISOString(),
    });
  } catch {
    return { ok: false, status: "CANDIDATE_NOT_CONFIRMABLE", http_status: 400 };
  }

  const saved = await store.confirmDiscoverySession({
    sessionId: session.id,
    selectedCandidateId: args.candidateId,
    lockedFingerprintSnapshotJson: JSON.stringify({
      fingerprint: confirmed.fingerprint,
      match_tier: confirmed.match_tier,
      match_rule_version: confirmed.match_rule_version,
      candidate,
    }),
  });
  if (!saved) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  return {
    ok: true,
    status: "PRODUCT_CONFIRMED",
    discovery_session_id: session.id,
    target_product_url: confirmed.fingerprint.target_product_url,
    target_item_id: confirmed.fingerprint.target_item_id ?? null,
    model_number: confirmed.fingerprint.model_number ?? null,
    upc_or_gtin: confirmed.fingerprint.upc_or_gtin ?? null,
  };
}

export type PreflightMonitoringResult =
  | {
      ok: true;
      status: "MONITORING_PAYMENT_READY";
      quote_id: string;
      price_amount: number;
      price_currency: string;
      quote_expires_at: string;
      monitoring_deadline: string | null;
    }
  | { ok: false; status: "ACTION_NOT_AUTHORIZED"; http_status: 401 }
  | { ok: false; status: "CONSENT_REQUIRED"; http_status: 400 }
  | { ok: false; status: "CONNECTION_EXPIRED"; http_status: 404 }
  | { ok: false; status: "PRODUCT_CONFIRMATION_REQUIRED"; http_status: 400 }
  | {
      ok: false;
      status: "UNSUPPORTED_PURCHASE" | "POLICY_EXCLUSION" | "WINDOW_EXPIRED" | "POLICY_STALE";
      http_status: 200;
    }
  | { ok: false; error: "quote_issuance_failed"; http_status: 503 };

/**
 * PREFLIGHT_MONITORING — the free/paid boundary. Requires a verified
 * connection (Lane 7.4B) and both durable consents; materializes exactly one
 * account-owned purchase from the confirmed discovery session, attaches the
 * locked fingerprint, runs deterministic eligibility, and only on full pass
 * mints an expiring $0.99 quote. Idempotent: retries/concurrency for the same
 * session never create a second purchase or a second active quote, and a
 * purchase-insertion failure after a successful session reservation recovers
 * on retry using the reserved purchase id.
 *
 * Lane 7.4C.1: never activates monitoring. The purchase is left in the
 * truthful, scheduler-ineligible `MONITORING_PAYMENT_READY_STATUS`
 * (`src/matching/store.ts`) — only Lane 7.4D `START_MONITORING`, after
 * verified payment, may transition it to `MONITORING_ACTIVE`.
 */
export async function preflightMonitoringForAgent(args: {
  connectionId: string;
  connectionToken: string;
  discoverySessionId: string;
  monitoringConsent: boolean;
  emailAlertConsent: boolean;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
}): Promise<PreflightMonitoringResult> {
  const auth = await authorizeAgentConnection({
    connectionId: args.connectionId,
    connectionToken: args.connectionToken,
    now: args.now,
    sqliteDb: args.sqliteDb,
    env: args.env,
  });
  if (!auth.ok) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }
  if (!auth.connection.account_id || !isAccountOwnerRef(auth.connection.account_id)) {
    return { ok: false, status: "ACTION_NOT_AUTHORIZED", http_status: 401 };
  }

  if (!args.monitoringConsent || !args.emailAlertConsent) {
    return { ok: false, status: "CONSENT_REQUIRED", http_status: 400 };
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  const session = await store.getDiscoverySessionById(args.discoverySessionId);
  if (!session) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  if (session.status === "discovering") {
    return { ok: false, status: "PRODUCT_CONFIRMATION_REQUIRED", http_status: 400 };
  }

  if (session.status === "confirmed" && !isFreshSession(session, now)) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  const db = getWebDatabase();
  const accountId = auth.connection.account_id;

  let purchaseId: string;
  if (session.status === "materialized" && session.materialized_purchase_id) {
    purchaseId = session.materialized_purchase_id;
  } else if (session.status === "confirmed") {
    purchaseId = newPurchaseId();
    const reserved = await store.reserveDiscoverySessionMaterialization({
      sessionId: session.id,
      purchaseId,
    });
    if (!reserved) {
      // Lost the race — reload and use the winner's purchase id.
      const latest = await store.getDiscoverySessionById(session.id);
      if (!latest?.materialized_purchase_id) {
        return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
      }
      purchaseId = latest.materialized_purchase_id;
    }
  } else {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  // The session may already be reserved (status='materialized') for this
  // purchase id without the purchase row itself ever having been inserted —
  // a prior call could have crashed between reservation and insertion.
  // Recover by inserting it now using the reserved id; a concurrent
  // recoverer racing on the same id is caught and re-read (id is the
  // primary key), so this never creates a duplicate.
  let purchaseRow = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;

  if (!purchaseRow) {
    const snapshot = JSON.parse(session.structured_snapshot_json) as {
      purchase_price: number;
      purchase_date: string;
      purchase_channel: string;
      country: string;
      region: string | null;
      target_product_url: string;
      target_item_id: string | null;
      model_number: string | null;
      upc_or_gtin: string | null;
    };
    const lockedSnapshotForInsert = JSON.parse(
      session.locked_fingerprint_snapshot_json || "{}",
    ) as {
      fingerprint?: {
        target_product_url: string;
        target_item_id?: string | null;
        model_number?: string | null;
        upc_or_gtin?: string | null;
      };
    };
    const fpForInsert = lockedSnapshotForInsert.fingerprint;
    const deadline = addCalendarDays(
      snapshot.purchase_date,
      TARGET_US_POLICY.window.days,
    );

    try {
      db.prepare(
        `INSERT INTO purchases (
          id, user_ref, target_product_url, purchase_price, currency, purchase_date,
          country, region, purchase_channel, model_number, upc_or_gtin, target_item_id,
          is_target_plus, known_exclusion, status, fingerprint_id, monitoring_deadline,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        purchaseId,
        accountId,
        fpForInsert?.target_product_url || snapshot.target_product_url,
        snapshot.purchase_price,
        "USD",
        snapshot.purchase_date,
        snapshot.country,
        snapshot.region,
        snapshot.purchase_channel,
        fpForInsert?.model_number ?? snapshot.model_number,
        fpForInsert?.upc_or_gtin ?? snapshot.upc_or_gtin,
        fpForInsert?.target_item_id ?? snapshot.target_item_id,
        0,
        null,
        "MATCH_REVIEW_REQUIRED",
        null,
        deadline,
        nowIso,
        nowIso,
      );
    } catch {
      // Race: a concurrent recovery attempt already inserted this exact id.
    }
    purchaseRow = db
      .prepare(`SELECT * FROM purchases WHERE id = ?`)
      .get(purchaseId) as Record<string, unknown> | undefined;
  }

  if (!purchaseRow) {
    return { ok: false, status: "CONNECTION_EXPIRED", http_status: 404 };
  }

  // Deterministic eligibility (channel/region/exclusion/window) before any
  // fingerprint lock or monitoring activation — fail closed with the exact
  // policy status, no quote minted.
  const policy = evaluateTargetPolicy(
    {
      purchase_channel: String(purchaseRow.purchase_channel),
      country: String(purchaseRow.country),
      region: (purchaseRow.region as string | null) ?? undefined,
      purchase_date: String(purchaseRow.purchase_date),
      purchase_price: Number(purchaseRow.purchase_price),
      currency: "USD",
      is_target_plus: false,
      has_receipt_or_packing_slip: true,
      has_locked_fingerprint: false,
      evaluated_at: nowIso,
    },
    { skip_freshness_check: true },
  );

  if (FAIL_CLOSED_POLICY_STATUSES.has(policy.status)) {
    return {
      ok: false,
      status: policy.status as
        | "UNSUPPORTED_PURCHASE"
        | "POLICY_EXCLUSION"
        | "WINDOW_EXPIRED"
        | "POLICY_STALE",
      http_status: 200,
    };
  }

  // Attach the locked fingerprint WITHOUT activating monitoring (idempotent:
  // only the first pass locks; retries reuse the already-persisted
  // fingerprint). Never MONITORING_ACTIVE here — see
  // confirmAndPersistLockedFingerprintPending doc comment.
  let fingerprintId = purchaseRow.fingerprint_id as string | null;
  if (!fingerprintId) {
    const lockedSnapshot = JSON.parse(
      session.locked_fingerprint_snapshot_json || "{}",
    ) as { candidate?: ScoredCandidate };
    if (!lockedSnapshot.candidate) {
      return { ok: false, status: "PRODUCT_CONFIRMATION_REQUIRED", http_status: 400 };
    }
    const confirmRef = {
      purchase_id: purchaseId,
      target_product_url: String(purchaseRow.target_product_url),
      target_item_id: (purchaseRow.target_item_id as string | null) ?? undefined,
      model_number: (purchaseRow.model_number as string | null) ?? undefined,
      upc_or_gtin: (purchaseRow.upc_or_gtin as string | null) ?? undefined,
    };
    const fp = confirmAndPersistLockedFingerprintPending({
      db,
      purchase: confirmRef,
      candidate: lockedSnapshot.candidate,
      confirmed_at: nowIso,
    });
    fingerprintId = fp.fingerprint_id;
  }

  const authStore = await resolveStore(args.sqliteDb, args.env);
  const existingQuote = await authStore.getActiveMonitoringEnrollmentQuote(
    purchaseId,
    nowIso,
  );
  if (existingQuote) {
    await persistAccountPurchaseIfNeeded({ purchaseDb: db, purchaseId, ownerRef: accountId });
    return {
      ok: true,
      status: "MONITORING_PAYMENT_READY",
      quote_id: existingQuote.id,
      price_amount: existingQuote.price_amount,
      price_currency: existingQuote.price_currency,
      quote_expires_at: existingQuote.expires_at,
      monitoring_deadline: existingQuote.monitoring_deadline,
    };
  }

  let quote;
  try {
    quote = await authStore.insertMonitoringEnrollmentQuote({
      connectionId: args.connectionId,
      accountId,
      purchaseId,
      fingerprintId,
      priceAmount: MONITORING_ENROLLMENT_PRICE_USD,
      priceCurrency: "USD",
      monitoringDeadline: (purchaseRow.monitoring_deadline as string | null) ?? null,
      consentMonitoringAt: nowIso,
      consentEmailAlertsAt: nowIso,
      now,
      ttlMs: QUOTE_TTL_MS,
    });
  } catch {
    // Race: another call minted the active quote first — reuse it. If no
    // active quote can be found either, fail closed without ever having
    // touched purchases.status (the fingerprint lock above never sets
    // MONITORING_ACTIVE) — no active purchase is left behind.
    const winner = await authStore.getActiveMonitoringEnrollmentQuote(purchaseId, nowIso);
    if (!winner) {
      return { ok: false, error: "quote_issuance_failed", http_status: 503 };
    }
    quote = winner;
  }

  await persistAccountPurchaseIfNeeded({ purchaseDb: db, purchaseId, ownerRef: accountId });

  return {
    ok: true,
    status: "MONITORING_PAYMENT_READY",
    quote_id: quote.id,
    price_amount: quote.price_amount,
    price_currency: quote.price_currency,
    quote_expires_at: quote.expires_at,
    monitoring_deadline: quote.monitoring_deadline,
  };
}
