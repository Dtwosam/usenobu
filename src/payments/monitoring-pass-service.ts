/**
 * Lane 8R.3B — the paid A2MCP service: one $0.99 Nobu Monitoring Pass.
 *
 * Why this exists. The previous paid endpoint (`/v1/agent/start-monitoring`)
 * only issued its x402 challenge *after* a caller already held a quote, a
 * verified connection, a confirmed product and recorded consent. A first-time
 * caller — including OKX's own validator — therefore got `400`/`401` instead
 * of `402`, and `agent x402-check` reported `valid: false`
 * (`docs/proof/lane-8r-3a-timeout-diagnosis/`).
 *
 * A pass decouples payment from enrollment. First contact needs nothing:
 * GET or POST, with or without a body, always returns the 402 challenge.
 * Redemption (free `REDEEM_MONITORING_PASS` on `/v1/agent`) is where every
 * identity, confirmation, eligibility and consent gate still applies —
 * unchanged, and a failed redemption never consumes the pass.
 *
 * Exactly-once issuance is anchored on the OKX-verified settlement
 * reference, never on anything the caller supplies:
 *   - `monitoring_passes.settlement_ref` is UNIQUE, so one verified
 *     settlement can only ever produce one pass;
 *   - a duplicate, concurrent, or lost-response replay of the same signed
 *     payment re-verifies to the same settlement reference and therefore
 *     resolves to the same pass;
 *   - a pending settlement is recorded against the sha256 digest of the
 *     replayed header (never the header itself) so it stays recoverable.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/index.js";
import {
  getAuthStore,
  type AuthStore,
  type MonitoringPassRow,
} from "../auth/auth-store.js";
import { sha256Hex } from "../auth/crypto.js";
import {
  buildX402Challenge,
  encodeX402ChallengeHeader,
  resolveX402Verifier,
  MONITORING_PRICE_USD,
  type X402Challenge,
  type X402Verifier,
} from "./x402.js";
import {
  createOkxSellerVerifier,
  type OkxSellerVerifyOutcome,
} from "./okx-seller-verifier.js";
import {
  isOkxSellerConfigured,
  loadOkxSellerConfig,
  OkxSellerClient,
} from "./okx-seller-client.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Exact wording used in the challenge and in the issued-pass response. */
export const MONITORING_PASS_RESOURCE_DESCRIPTION =
  "One Nobu Monitoring Pass ($0.99). Redeemable once to activate price monitoring for one confirmed, eligible Target purchase. Payment does not guarantee a price drop, alert, refund, adjustment or savings.";

export const MONITORING_PASS_REDEEMABLE_FOR =
  "Activating monitoring for one confirmed eligible Target purchase via REDEEM_MONITORING_PASS on https://usenobu.vercel.app/v1/agent";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * Opaque, high-entropy, single-use pass credential. Only its sha256 digest is
 * stored — the same pattern Lane 7.4B uses for `connection_token`. The token
 * is returned exactly once, in the issuance response.
 */
function mintPassToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

async function resolveStore(
  sqliteDb?: NobuDatabase,
  env?: EnvRecord,
): Promise<AuthStore> {
  return getAuthStore({ sqliteDb, env });
}

export function buildMonitoringPassChallenge(args: {
  resource: string;
  env?: EnvRecord;
  payTo?: string | null;
}): X402Challenge {
  return buildX402Challenge({
    resource: args.resource,
    description: MONITORING_PASS_RESOURCE_DESCRIPTION,
    payTo: args.payTo,
    env: args.env,
  });
}

export interface MonitoringPassArgs {
  /** Raw PAYMENT-SIGNATURE header from the replay, or null on first contact. */
  paymentAuthorizationHeader: string | null;
  /** Absolute URL of this paid resource. */
  resource: string;
  now?: Date;
  sqliteDb?: NobuDatabase;
  env?: EnvRecord;
  /** Tests only — forbidden outside test mode by resolveX402Verifier. */
  testVerifier?: X402Verifier;
}

export type MonitoringPassResult =
  | {
      ok: true;
      status: "MONITORING_PASS_ISSUED";
      http_status: 200;
      pass: MonitoringPassRow;
      /** Returned exactly once, only when this call issued the pass. */
      passToken: string | null;
    }
  | {
      ok: true;
      status: "PAYMENT_SETTLEMENT_PENDING";
      http_status: 200;
      note: string;
    }
  | {
      ok: false;
      status: "PAYMENT_PENDING";
      http_status: 402;
      challenge: X402Challenge;
      challengeHeaderValue: string;
    };

function challengeResult(args: {
  resource: string;
  env?: EnvRecord;
}): MonitoringPassResult {
  const challenge = buildMonitoringPassChallenge({
    resource: args.resource,
    env: args.env,
  });
  return {
    ok: false,
    status: "PAYMENT_PENDING",
    http_status: 402,
    challenge,
    challengeHeaderValue: encodeX402ChallengeHeader(challenge),
  };
}

/**
 * Issues (or re-resolves) exactly one pass for a verified settlement.
 * The token is only ever returned by the call that actually created the row.
 */
async function issuePassForSettlement(args: {
  store: AuthStore;
  settlementRef: string;
  paymentId: string;
  nowIso: string;
}): Promise<MonitoringPassResult> {
  const existing = await args.store.getMonitoringPassBySettlementRef(
    args.settlementRef,
  );
  if (existing) {
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: existing,
      passToken: null,
    };
  }

  const { token, hash } = mintPassToken();
  const issued = await args.store.issueMonitoringPass({
    id: newId("pass"),
    passTokenHash: hash,
    settlementRef: args.settlementRef,
    paymentId: args.paymentId,
    priceAmount: MONITORING_PRICE_USD,
    priceCurrency: "USD",
    nowIso: args.nowIso,
  });

  return {
    ok: true,
    status: "MONITORING_PASS_ISSUED",
    http_status: 200,
    pass: issued.pass,
    // A concurrent caller that lost the UNIQUE race never learns a token it
    // did not mint; it still receives the same pass id.
    passToken: issued.outcome === "issued" ? token : null,
  };
}

/**
 * GET/POST `/v1/agent/monitoring-pass`.
 *
 * No quote, connection, purchase or consent is consulted before the
 * challenge is issued — first contact is a pure challenge build.
 */
export async function monitoringPassForAgent(
  args: MonitoringPassArgs,
): Promise<MonitoringPassResult> {
  const now = args.now ?? new Date();
  const nowIso = now.toISOString();

  // First contact — always 402, immediately, with no dependency touched.
  if (!args.paymentAuthorizationHeader) {
    return challengeResult({ resource: args.resource, env: args.env });
  }

  const store = await resolveStore(args.sqliteDb, args.env);
  const authorizationDigest = sha256Hex(args.paymentAuthorizationHeader);

  // A repeated replay of the same signed payment must not settle twice.
  const priorPayment =
    await store.getMonitoringPassPaymentByDigest(authorizationDigest);
  if (priorPayment?.status === "settled" && priorPayment.settlement_ref) {
    return issuePassForSettlement({
      store,
      settlementRef: priorPayment.settlement_ref,
      paymentId: priorPayment.id,
      nowIso,
    });
  }
  if (priorPayment?.status === "verifying" && priorPayment.settlement_ref) {
    return resumePendingPassSettlement({
      store,
      payment: priorPayment,
      resource: args.resource,
      env: args.env,
      nowIso,
    });
  }

  const payment = await store.upsertMonitoringPassPayment({
    id: newId("pass_pay"),
    authorizationDigest,
    nowIso,
  });

  let settlementRef: string | null = null;
  let pendingTxHash: string | null = null;

  if (args.testVerifier) {
    const verifier = resolveX402Verifier({
      env: args.env,
      testVerifier: args.testVerifier,
    });
    const verified = await verifier.verifyPayment({
      resource: args.resource,
      authorizationHeader: args.paymentAuthorizationHeader,
    });
    if (!verified.ok) {
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "failed",
        settlementRef: null,
        nowIso,
      });
      return challengeResult({ resource: args.resource, env: args.env });
    }
    settlementRef = verified.settlementRef;
  } else if (isOkxSellerConfigured(args.env ?? process.env)) {
    const seller = createOkxSellerVerifier({ env: args.env });
    const detailed: OkxSellerVerifyOutcome =
      await seller.verifyAndSettleDetailed({
        resource: args.resource,
        authorizationHeader: args.paymentAuthorizationHeader,
      });
    if (detailed.ok) {
      settlementRef = detailed.settlementRef;
    } else if (
      detailed.reason === "settlement_pending" &&
      detailed.pendingTxHash
    ) {
      pendingTxHash = detailed.pendingTxHash;
    } else {
      await store.updateMonitoringPassPayment({
        id: payment.id,
        status: "failed",
        settlementRef: null,
        nowIso,
      });
      return challengeResult({ resource: args.resource, env: args.env });
    }
  } else {
    // No seller credentials — fail closed, never invent a settlement.
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "failed",
      settlementRef: null,
      nowIso,
    });
    return challengeResult({ resource: args.resource, env: args.env });
  }

  if (pendingTxHash) {
    await store.updateMonitoringPassPayment({
      id: payment.id,
      status: "verifying",
      settlementRef: pendingTxHash,
      nowIso,
    });
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      note: "Settlement submitted; awaiting on-chain confirmation. No pass is issued until it confirms. Replay this request to check again.",
    };
  }

  if (!settlementRef) {
    return challengeResult({ resource: args.resource, env: args.env });
  }

  await store.updateMonitoringPassPayment({
    id: payment.id,
    status: "settled",
    settlementRef,
    nowIso,
  });

  return issuePassForSettlement({
    store,
    settlementRef,
    paymentId: payment.id,
    nowIso,
  });
}

/**
 * Polls the official settle-status API for a settlement that was already
 * submitted. Never re-verifies or re-charges — it only reads the outcome of
 * the payment already recorded against this authorization digest.
 */
async function resumePendingPassSettlement(args: {
  store: AuthStore;
  payment: { id: string; settlement_ref: string | null };
  resource: string;
  env?: EnvRecord;
  nowIso: string;
}): Promise<MonitoringPassResult> {
  const pendingTxHash = args.payment.settlement_ref!;
  const existing =
    await args.store.getMonitoringPassBySettlementRef(pendingTxHash);
  if (existing) {
    return {
      ok: true,
      status: "MONITORING_PASS_ISSUED",
      http_status: 200,
      pass: existing,
      passToken: null,
    };
  }

  const cfg = loadOkxSellerConfig(args.env ?? process.env);
  if (!cfg) {
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      note: "Settlement still pending confirmation.",
    };
  }

  try {
    const client = new OkxSellerClient(cfg);
    const status = await client.getSettleStatus(pendingTxHash);
    if (status.status === "pending" || (!status.success && !status.status)) {
      return {
        ok: true,
        status: "PAYMENT_SETTLEMENT_PENDING",
        http_status: 200,
        note: "Settlement still pending confirmation.",
      };
    }
    if (status.status === "failed" || status.success === false) {
      await args.store.updateMonitoringPassPayment({
        id: args.payment.id,
        status: "failed",
        settlementRef: null,
        nowIso: args.nowIso,
      });
      return challengeResult({ resource: args.resource, env: args.env });
    }

    const settlementRef = String(
      status.transaction || pendingTxHash,
    ).trim();
    await args.store.updateMonitoringPassPayment({
      id: args.payment.id,
      status: "settled",
      settlementRef,
      nowIso: args.nowIso,
    });
    return issuePassForSettlement({
      store: args.store,
      settlementRef,
      paymentId: args.payment.id,
      nowIso: args.nowIso,
    });
  } catch {
    return {
      ok: true,
      status: "PAYMENT_SETTLEMENT_PENDING",
      http_status: 200,
      note: "Settlement status unavailable; still not payment complete.",
    };
  }
}

/** Response body shapes — never include the settlement reference or digest. */
export function monitoringPassResponseBody(
  result: MonitoringPassResult,
): Record<string, unknown> {
  if (result.ok && result.status === "MONITORING_PASS_ISSUED") {
    const body: Record<string, unknown> = {
      agent_state: "MONITORING_PASS",
      status: "MONITORING_PASS_ISSUED",
      monitoring_pass_id: result.pass.id,
      price_amount: Number(result.pass.price_amount),
      price_currency: result.pass.price_currency,
      redeemable_for: MONITORING_PASS_REDEEMABLE_FOR,
      next_action:
        "Complete the free setup flow on https://usenobu.vercel.app/v1/agent (DISCOVER_PRODUCT, CONFIRM_PRODUCT, BEGIN_EMAIL_VERIFICATION, VERIFY_EMAIL_CODE, PREFLIGHT_MONITORING) to obtain a quote_id, then call REDEEM_MONITORING_PASS with this pass.",
      documentation: "https://www.usenobu.xyz/okx",
    };
    if (result.passToken) {
      body.monitoring_pass_token = result.passToken;
      body.message =
        "Store monitoring_pass_token now — it is returned exactly once and is required to redeem this pass.";
    } else {
      body.message =
        "This pass was already issued for this payment. The one-time monitoring_pass_token was returned with the original response and is not repeated.";
    }
    return body;
  }

  if (result.ok) {
    return {
      agent_state: "MONITORING_PASS",
      status: "PAYMENT_SETTLEMENT_PENDING",
      message: result.note,
      next_action:
        "Replay this request with the same PAYMENT-SIGNATURE header to check settlement again.",
      documentation: "https://www.usenobu.xyz/okx",
    };
  }

  return {
    agent_state: "MONITORING_PASS",
    status: "PAYMENT_PENDING",
    x402Version: result.challenge.x402Version,
    resource: result.challenge.resource,
    accepts: result.challenge.accepts,
    message:
      "Payment required for one Nobu Monitoring Pass. Pay the challenge in the PAYMENT-REQUIRED header and replay this request with the signed PAYMENT-SIGNATURE header.",
    next_action:
      "Sign the PAYMENT-REQUIRED challenge and replay this request with the PAYMENT-SIGNATURE header.",
    documentation: "https://www.usenobu.xyz/okx",
  };
}
