/**
 * Official OKX seller adapter implementing X402Verifier.
 *
 * Flow (signature alone is never enough):
 *  1. Parse PAYMENT-SIGNATURE as PaymentPayload (never log raw).
 *  2. Build PaymentRequirements server-side from stored quote + env (never trust client).
 *  3. POST /api/v6/pay/x402/verify — fail closed if not valid.
 *  4. POST /api/v6/pay/x402/settle — success → settlementRef = transaction;
 *     pending → settlement_pending with opaque tx hash for later status poll.
 *
 * Does not replace the durable activation saga — only supplies a verified settlement ref.
 */
import {
  buildSettlementExtra,
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_MAX_TIMEOUT_SECONDS,
  type X402Verifier,
  type X402VerifyInput,
  type X402VerifyResult,
} from "./x402.js";
import {
  loadOkxSellerConfig,
  OkxSellerClient,
  OKX_X402_VERSION,
  type OkxHttpFetch,
  type PaymentPayload,
  type PaymentRequirements,
} from "./okx-seller-client.js";

export type OkxSellerVerifyOutcome =
  | { ok: true; settlementRef: string; verifiedVia: "okx-seller" }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_configured"
        | "provider_error"
        | "amount_mismatch"
        | "resource_mismatch"
        | "settle_failed"
        | "settlement_pending";
      /** Opaque tx hash when settlement is pending (never a payment credential). */
      pendingTxHash?: string;
    };

/**
 * Decode PAYMENT-SIGNATURE header. Accepts base64url/base64 JSON or raw JSON.
 * Never logs the raw value.
 */
export function parsePaymentPayloadFromHeader(
  authorizationHeader: string,
): PaymentPayload | null {
  const raw = String(authorizationHeader || "").trim();
  if (!raw) return null;
  try {
    // raw JSON object
    if (raw.startsWith("{")) {
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === "object") return obj as PaymentPayload;
      return null;
    }
    // base64url or base64
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === "object") return obj as PaymentPayload;
    return null;
  } catch {
    return null;
  }
}

/**
 * Server-built requirements. These must mirror the accepts entry the buyer
 * signed, so they carry the same maxTimeoutSeconds and EIP-712 token
 * metadata. `quoteId` is absent for a Monitoring Pass, which is sold with no
 * prerequisites and therefore binds to no quote.
 */
export function buildServerPaymentRequirements(args: {
  resource: string;
  quoteId?: string;
  payTo: string;
  amount?: string;
  network?: string;
  asset?: string;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: args.network ?? DEFAULT_SETTLEMENT_NETWORK,
    asset: args.asset ?? DEFAULT_SETTLEMENT_ASSET,
    amount: args.amount ?? MONITORING_PRICE_ATOMIC_UNITS,
    resource: args.resource,
    payTo: args.payTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: buildSettlementExtra(args.quoteId),
  };
}

/**
 * Reject payloads that try to smuggle different amount/asset/payTo/resource.
 * We still send server-built requirements to OKX; this is defense in depth.
 */
export function assertPayloadDoesNotOverrideServerTerms(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): "ok" | "amount_mismatch" | "resource_mismatch" {
  const accepted = payload.accepted as Record<string, unknown> | undefined;
  if (!accepted || typeof accepted !== "object") return "ok";
  if (
    accepted.amount != null &&
    String(accepted.amount) !== requirements.amount
  ) {
    return "amount_mismatch";
  }
  if (
    accepted.resource != null &&
    String(accepted.resource) !== requirements.resource
  ) {
    return "resource_mismatch";
  }
  if (
    accepted.payTo != null &&
    String(accepted.payTo).toLowerCase() !== requirements.payTo.toLowerCase()
  ) {
    return "amount_mismatch";
  }
  if (
    accepted.asset != null &&
    String(accepted.asset).toLowerCase() !== requirements.asset.toLowerCase()
  ) {
    return "amount_mismatch";
  }
  if (
    accepted.network != null &&
    String(accepted.network) !== requirements.network
  ) {
    return "amount_mismatch";
  }
  return "ok";
}

export function createOkxSellerVerifier(args: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: OkxHttpFetch;
  client?: OkxSellerClient;
}): X402Verifier & {
  verifyAndSettleDetailed: (
    input: X402VerifyInput,
  ) => Promise<OkxSellerVerifyOutcome>;
} {
  const env = args.env ?? process.env;
  const config = loadOkxSellerConfig(env);
  const client =
    args.client ??
    (config
      ? new OkxSellerClient(config, args.fetchImpl)
      : null);

  async function verifyAndSettleDetailed(
    input: X402VerifyInput,
  ): Promise<OkxSellerVerifyOutcome> {
    if (!client || !config) {
      return { ok: false, reason: "not_configured" };
    }

    const payload = parsePaymentPayloadFromHeader(input.authorizationHeader);
    if (!payload) {
      return { ok: false, reason: "invalid_signature" };
    }

    const requirements = buildServerPaymentRequirements({
      resource: input.resource,
      quoteId: input.quoteId,
      payTo: client.payTo,
    });

    const termCheck = assertPayloadDoesNotOverrideServerTerms(
      payload,
      requirements,
    );
    if (termCheck !== "ok") {
      return { ok: false, reason: termCheck };
    }

    let verifyRes;
    try {
      verifyRes = await client.verify(payload, requirements);
    } catch {
      return { ok: false, reason: "provider_error" };
    }
    if (!verifyRes.isValid) {
      return { ok: false, reason: "invalid_signature" };
    }

    // Signature verification alone is not settlement.
    let settleRes;
    try {
      settleRes = await client.settle(payload, requirements);
    } catch {
      return { ok: false, reason: "provider_error" };
    }

    if (settleRes.status === "pending") {
      const tx = String(settleRes.transaction || "").trim();
      if (!tx) return { ok: false, reason: "settle_failed" };
      return {
        ok: false,
        reason: "settlement_pending",
        pendingTxHash: tx,
      };
    }

    if (
      !settleRes.success ||
      settleRes.status === "timeout" ||
      !settleRes.transaction
    ) {
      return { ok: false, reason: "settle_failed" };
    }

    return {
      ok: true,
      settlementRef: String(settleRes.transaction),
      verifiedVia: "okx-seller",
    };
  }

  return {
    label: "okx-seller",
    async verifyPayment(input: X402VerifyInput): Promise<X402VerifyResult> {
      const detailed = await verifyAndSettleDetailed(input);
      if (detailed.ok) {
        return {
          ok: true,
          settlementRef: detailed.settlementRef,
          verifiedVia: detailed.verifiedVia,
        };
      }
      // Map settlement_pending / settle_failed into provider_error for the
      // basic X402VerifyResult surface; start-monitoring uses detailed path.
      if (
        detailed.reason === "settlement_pending" ||
        detailed.reason === "settle_failed"
      ) {
        return { ok: false, reason: "provider_error" };
      }
      return { ok: false, reason: detailed.reason };
    },
    verifyAndSettleDetailed,
  };
}

export { OKX_X402_VERSION };
