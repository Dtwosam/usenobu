/**
 * Official OKX seller adapter implementing X402Verifier.
 *
 * Flow (signature alone is never enough):
 *  1. Parse PAYMENT-SIGNATURE as PaymentPayload (never log raw).
 *  2. Build PaymentRequirements server-side from locked terms + env.
 *  3. Optionally enrich EIP-712 extras from facilitator /supported.
 *  4. POST verify — fail closed if not valid.
 *  5. POST settle — success → settlementRef; pending → poll; ambiguous
 *     transport after settle submission → settlement_unknown (never a new challenge).
 *
 * Does not issue passes — only supplies a verified settlement outcome.
 */
import {
  buildSettlementExtra,
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  decodePaymentSignatureHeaderSafe,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_MAX_TIMEOUT_SECONDS,
  type X402Verifier,
  type X402VerifyInput,
  type X402VerifyResult,
} from "./x402.js";
import {
  loadOkxSellerConfig,
  OkxSellerClient,
  OkxSellerBusinessError,
  OkxSellerHttpError,
  OKX_X402_VERSION,
  sanitizeReason,
  type OkxHttpFetch,
  type PaymentPayload,
  type PaymentRequirements,
} from "./okx-seller-client.js";

export type OkxSellerVerifyOutcome =
  | {
      ok: true;
      settlementRef: string;
      verifiedVia: "okx-seller";
      payer?: string;
      network?: string;
      amount?: string;
    }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_configured"
        | "provider_error"
        | "amount_mismatch"
        | "resource_mismatch"
        | "settle_failed"
        | "settlement_pending"
        | "settlement_unknown"
        | "rejected";
      /** Opaque tx hash when settlement is pending/unknown (never a payment credential). */
      pendingTxHash?: string;
      payer?: string;
      sanitizedVerifyReason?: string;
      sanitizedSettleReason?: string;
      lastProviderOperation?: string;
    };

/**
 * Decode PAYMENT-SIGNATURE header via official-compatible path.
 * Never logs the raw value.
 */
export function parsePaymentPayloadFromHeader(
  authorizationHeader: string,
): PaymentPayload | null {
  return decodePaymentSignatureHeaderSafe(authorizationHeader);
}

/**
 * Server-built requirements. These must mirror the accepts entry the buyer
 * signed, so they carry the same maxTimeoutSeconds and EIP-712 token
 * metadata. `quoteId` is absent for a Monitoring Pass.
 */
export function buildServerPaymentRequirements(args: {
  resource: string;
  quoteId?: string;
  payTo: string;
  amount?: string;
  network?: string;
  asset?: string;
  supportedKindExtra?: Record<string, unknown> | null;
}): PaymentRequirements {
  return {
    scheme: "exact",
    network: args.network ?? DEFAULT_SETTLEMENT_NETWORK,
    asset: args.asset ?? DEFAULT_SETTLEMENT_ASSET,
    amount: args.amount ?? MONITORING_PRICE_ATOMIC_UNITS,
    resource: args.resource,
    payTo: args.payTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra: buildSettlementExtra(args.quoteId, args.supportedKindExtra),
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

/** Bounded same-request settle/status poll after pending (wall budget ~3s). */
const SETTLE_POLL_DELAYS_MS = [400, 800, 1200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  async function loadSupportedKindExtra(): Promise<Record<string, unknown> | null> {
    if (!client) return null;
    try {
      const supported = await client.getSupported();
      const kinds = Array.isArray(supported?.kinds) ? supported.kinds : [];
      const match = kinds.find(
        (k) =>
          k &&
          Number(k.x402Version) === OKX_X402_VERSION &&
          String(k.scheme) === "exact" &&
          String(k.network) === DEFAULT_SETTLEMENT_NETWORK,
      );
      if (match?.extra && typeof match.extra === "object") {
        return match.extra as Record<string, unknown>;
      }
    } catch {
      // Supported-kind sync is best-effort; locked extras still apply.
    }
    return null;
  }

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

    const supportedKindExtra = await loadSupportedKindExtra();
    const requirements = buildServerPaymentRequirements({
      resource: input.resource,
      quoteId: input.quoteId,
      payTo: client.payTo,
      supportedKindExtra,
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
    } catch (err) {
      if (err instanceof OkxSellerBusinessError) {
        return {
          ok: false,
          reason: "rejected",
          sanitizedVerifyReason: sanitizeReason(err.msg ?? err.code),
          lastProviderOperation: "verify",
        };
      }
      return {
        ok: false,
        reason: "provider_error",
        lastProviderOperation: "verify",
        sanitizedVerifyReason:
          err instanceof Error ? sanitizeReason(err.message) : undefined,
      };
    }
    if (!verifyRes.isValid) {
      return {
        ok: false,
        reason: "invalid_signature",
        payer: verifyRes.payer,
        sanitizedVerifyReason: sanitizeReason(
          verifyRes.invalidReason || verifyRes.invalidMessage,
        ),
        lastProviderOperation: "verify",
      };
    }

    // Signature verification alone is not settlement.
    let settleRes;
    try {
      settleRes = await client.settle(payload, requirements);
    } catch (err) {
      // Conclusive HTTP business failures (4xx from facilitator after body parse
      // path) and OKX business codes are settle_failed. Ambiguous transport
      // (network reset, zero status) after settle submission is settlement_unknown.
      if (err instanceof OkxSellerBusinessError) {
        return {
          ok: false,
          reason: "settle_failed",
          lastProviderOperation: "settle",
          sanitizedSettleReason: sanitizeReason(err.msg ?? err.code),
          payer: verifyRes.payer,
        };
      }
      if (err instanceof OkxSellerHttpError) {
        // HTTP 4xx/5xx on settle without a durable tx hash: treat 4xx as
        // settle_failed (request rejected), 5xx/0 as settlement_unknown.
        if (err.status >= 400 && err.status < 500) {
          return {
            ok: false,
            reason: "settle_failed",
            lastProviderOperation: "settle",
            sanitizedSettleReason: sanitizeReason(err.message),
            payer: verifyRes.payer,
          };
        }
        return {
          ok: false,
          reason: "settlement_unknown",
          lastProviderOperation: "settle",
          sanitizedSettleReason: sanitizeReason(err.message),
          payer: verifyRes.payer,
        };
      }
      return {
        ok: false,
        reason: "settlement_unknown",
        lastProviderOperation: "settle",
        sanitizedSettleReason:
          err instanceof Error ? sanitizeReason(err.message) : undefined,
        payer: verifyRes.payer,
      };
    }

    const payer = settleRes.payer || verifyRes.payer;

    if (settleRes.status === "pending") {
      const tx = String(settleRes.transaction || "").trim();
      if (!tx) {
        return {
          ok: false,
          reason: "settlement_unknown",
          lastProviderOperation: "settle",
          sanitizedSettleReason: "pending_without_tx",
          payer,
        };
      }
      // Bounded poll for confirmation on the same request.
      for (const delay of SETTLE_POLL_DELAYS_MS) {
        await sleep(delay);
        try {
          const status = await client.getSettleStatus(tx);
          if (status.status === "success" || (status.success && status.status !== "failed" && status.status !== "pending")) {
            const settlementRef = String(status.transaction || tx).trim();
            if (settlementRef) {
              return {
                ok: true,
                settlementRef,
                verifiedVia: "okx-seller",
                payer: status.payer || payer,
                network: status.network,
              };
            }
          }
          if (status.status === "failed" || status.success === false) {
            return {
              ok: false,
              reason: "settle_failed",
              lastProviderOperation: "settle_status",
              sanitizedSettleReason: sanitizeReason(
                status.errorReason || status.errorMessage,
              ),
              payer: status.payer || payer,
              pendingTxHash: tx,
            };
          }
        } catch {
          // Keep pending; outer layer records settlement_pending.
        }
      }
      return {
        ok: false,
        reason: "settlement_pending",
        pendingTxHash: tx,
        payer,
        lastProviderOperation: "settle",
      };
    }

    if (settleRes.status === "timeout") {
      const tx = String(settleRes.transaction || "").trim();
      if (tx) {
        try {
          const status = await client.getSettleStatus(tx);
          if (status.status === "success" || (status.success && status.status !== "failed")) {
            return {
              ok: true,
              settlementRef: String(status.transaction || tx).trim(),
              verifiedVia: "okx-seller",
              payer: status.payer || payer,
              network: status.network,
            };
          }
          if (status.status === "pending") {
            return {
              ok: false,
              reason: "settlement_pending",
              pendingTxHash: tx,
              payer,
              lastProviderOperation: "settle_status",
            };
          }
        } catch {
          return {
            ok: false,
            reason: "settlement_unknown",
            pendingTxHash: tx,
            payer,
            lastProviderOperation: "settle_status",
          };
        }
      }
      return {
        ok: false,
        reason: "settlement_unknown",
        pendingTxHash: tx || undefined,
        payer,
        lastProviderOperation: "settle",
        sanitizedSettleReason: "timeout",
      };
    }

    if (!settleRes.success || !settleRes.transaction) {
      return {
        ok: false,
        reason: "settle_failed",
        lastProviderOperation: "settle",
        sanitizedSettleReason: sanitizeReason(
          settleRes.errorReason || settleRes.errorMessage,
        ),
        payer,
      };
    }

    return {
      ok: true,
      settlementRef: String(settleRes.transaction),
      verifiedVia: "okx-seller",
      payer,
      network: settleRes.network,
      amount: settleRes.amount,
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
          payer: detailed.payer,
        };
      }
      if (detailed.reason === "settlement_pending") {
        return {
          ok: false,
          reason: "settlement_pending",
          pendingTxHash: detailed.pendingTxHash,
          payer: detailed.payer,
          sanitizedReason: detailed.sanitizedSettleReason,
        };
      }
      if (detailed.reason === "settlement_unknown") {
        return {
          ok: false,
          reason: "settlement_unknown",
          pendingTxHash: detailed.pendingTxHash,
          payer: detailed.payer,
          sanitizedReason: detailed.sanitizedSettleReason,
        };
      }
      if (detailed.reason === "settle_failed") {
        return {
          ok: false,
          reason: "provider_error",
          sanitizedReason: detailed.sanitizedSettleReason,
        };
      }
      if (detailed.reason === "rejected") {
        return {
          ok: false,
          reason: "rejected",
          sanitizedReason: detailed.sanitizedVerifyReason,
        };
      }
      return {
        ok: false,
        reason:
          detailed.reason === "invalid_signature" ||
          detailed.reason === "not_configured" ||
          detailed.reason === "provider_error" ||
          detailed.reason === "amount_mismatch" ||
          detailed.reason === "resource_mismatch"
            ? detailed.reason
            : "provider_error",
        sanitizedReason:
          detailed.sanitizedVerifyReason || detailed.sanitizedSettleReason,
      };
    },
    verifyAndSettleDetailed,
  };
}

export { OKX_X402_VERSION };
