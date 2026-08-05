/**
 * Official OKX seller adapter.
 *
 * Verify and settle use the SAME canonical PaymentRequirements object that
 * was (or would be) placed in the PAYMENT-REQUIRED challenge accepts[0].
 * Never calls /supported only on replay to change signed metadata.
 */
import {
  decodePaymentSignatureHeaderSafe,
  DEFAULT_SETTLEMENT_ASSET,
  DEFAULT_SETTLEMENT_NETWORK,
  MONITORING_PRICE_ATOMIC_UNITS,
  X402_MAX_TIMEOUT_SECONDS,
  type X402Verifier,
  type X402VerifyInput,
  type X402VerifyResult,
} from "./x402.js";
import {
  buildCanonicalPaymentRequirements,
  paymentRequirementsDeepEqual,
  type CanonicalPaymentRequirements,
} from "./canonical-requirements.js";
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
      requirements: CanonicalPaymentRequirements;
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
        | "settlement_review_required"
        | "rejected";
      pendingTxHash?: string;
      payer?: string;
      sanitizedVerifyReason?: string;
      sanitizedSettleReason?: string;
      lastProviderOperation?: string;
      requirements?: CanonicalPaymentRequirements;
    };

export function parsePaymentPayloadFromHeader(
  authorizationHeader: string,
): PaymentPayload | null {
  return decodePaymentSignatureHeaderSafe(authorizationHeader);
}

/**
 * @deprecated Prefer buildCanonicalPaymentRequirements — kept for tests that
 * still call the sync builder. Does not include resource (official shape).
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
  void args.resource;
  void args.supportedKindExtra;
  const extra: Record<string, unknown> = {
    name: "USD₮0",
    version: "1",
  };
  if (args.quoteId) extra.quote_id = args.quoteId;
  return {
    scheme: "exact",
    network: args.network ?? DEFAULT_SETTLEMENT_NETWORK,
    asset: args.asset ?? DEFAULT_SETTLEMENT_ASSET,
    amount: args.amount ?? MONITORING_PRICE_ATOMIC_UNITS,
    resource: args.resource,
    payTo: args.payTo,
    maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
    extra,
  };
}

export function assertPayloadDoesNotOverrideServerTerms(
  payload: PaymentPayload,
  requirements: CanonicalPaymentRequirements | PaymentRequirements,
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
  if (
    accepted.scheme != null &&
    String(accepted.scheme) !== requirements.scheme
  ) {
    return "amount_mismatch";
  }
  return "ok";
}

const SETTLE_POLL_DELAYS_MS = [400, 800, 1200] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFacilitatorRequirements(
  r: CanonicalPaymentRequirements,
): PaymentRequirements {
  // Official facilitator PaymentRequirements has no resource field.
  return {
    scheme: "exact",
    network: r.network,
    asset: r.asset,
    amount: r.amount,
    payTo: r.payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    extra: r.extra,
  };
}

export function createOkxSellerVerifier(args: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: OkxHttpFetch;
  client?: OkxSellerClient;
}): X402Verifier & {
  verifyAndSettleDetailed: (
    input: X402VerifyInput,
  ) => Promise<OkxSellerVerifyOutcome>;
  /** Last requirements used (for equality proofs). */
  getLastRequirements: () => CanonicalPaymentRequirements | null;
} {
  const env = args.env ?? process.env;
  const config = loadOkxSellerConfig(env);
  const client =
    args.client ??
    (config ? new OkxSellerClient(config, args.fetchImpl) : null);
  let lastRequirements: CanonicalPaymentRequirements | null = null;

  async function resolveRequirements(
    input: X402VerifyInput,
  ): Promise<CanonicalPaymentRequirements | null> {
    if (input.requirements) {
      lastRequirements = input.requirements;
      return input.requirements;
    }
    if (!client) return null;
    const built = await buildCanonicalPaymentRequirements({
      payTo: client.payTo,
      quoteId: input.quoteId,
    });
    lastRequirements = built;
    return built;
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

    const requirements = await resolveRequirements(input);
    if (!requirements) {
      return { ok: false, reason: "not_configured" };
    }

    // Defense: accepted payload must not smuggle different commercial terms.
    const termCheck = assertPayloadDoesNotOverrideServerTerms(
      payload,
      requirements,
    );
    if (termCheck !== "ok") {
      return { ok: false, reason: termCheck, requirements };
    }

    // If buyer accepted object is present, it must deep-equal server requirements
    // (excluding optional buyer-only fields). Compare commercial+extra keys.
    const accepted = payload.accepted as
      | CanonicalPaymentRequirements
      | undefined;
    if (accepted && typeof accepted === "object") {
      const acceptedNorm: CanonicalPaymentRequirements = {
        scheme: "exact",
        network: String(accepted.network),
        asset: String(accepted.asset),
        amount: String(accepted.amount),
        payTo: String(accepted.payTo),
        maxTimeoutSeconds: Number(
          accepted.maxTimeoutSeconds ?? requirements.maxTimeoutSeconds,
        ),
        extra:
          accepted.extra && typeof accepted.extra === "object"
            ? (accepted.extra as Record<string, unknown>)
            : {},
      };
      // Soft check: commercial fields must match; extra should match when present.
      if (
        acceptedNorm.amount !== requirements.amount ||
        acceptedNorm.network !== requirements.network ||
        acceptedNorm.asset.toLowerCase() !== requirements.asset.toLowerCase() ||
        acceptedNorm.payTo.toLowerCase() !== requirements.payTo.toLowerCase()
      ) {
        return {
          ok: false,
          reason: "amount_mismatch",
          requirements,
          sanitizedVerifyReason: "accepted_terms_mismatch",
        };
      }
      void paymentRequirementsDeepEqual;
    }

    const facReq = toFacilitatorRequirements(requirements);

    let verifyRes;
    try {
      verifyRes = await client.verify(payload, facReq);
    } catch (err) {
      if (err instanceof OkxSellerBusinessError) {
        return {
          ok: false,
          reason: "rejected",
          sanitizedVerifyReason: sanitizeReason(err.msg ?? err.code),
          lastProviderOperation: "verify",
          requirements,
        };
      }
      return {
        ok: false,
        reason: "provider_error",
        lastProviderOperation: "verify",
        sanitizedVerifyReason:
          err instanceof Error ? sanitizeReason(err.message) : undefined,
        requirements,
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
        requirements,
      };
    }

    let settleRes;
    try {
      settleRes = await client.settle(payload, facReq);
    } catch (err) {
      if (err instanceof OkxSellerBusinessError) {
        return {
          ok: false,
          reason: "settle_failed",
          lastProviderOperation: "settle",
          sanitizedSettleReason: sanitizeReason(err.msg ?? err.code),
          payer: verifyRes.payer,
          requirements,
        };
      }
      if (err instanceof OkxSellerHttpError) {
        if (err.status >= 400 && err.status < 500) {
          return {
            ok: false,
            reason: "settle_failed",
            lastProviderOperation: "settle",
            sanitizedSettleReason: sanitizeReason(err.message),
            payer: verifyRes.payer,
            requirements,
          };
        }
        // Ambiguous transport with no tx → review required, not auto-reconcile claim.
        return {
          ok: false,
          reason: "settlement_review_required",
          lastProviderOperation: "settle",
          sanitizedSettleReason: sanitizeReason(err.message),
          payer: verifyRes.payer,
          requirements,
        };
      }
      return {
        ok: false,
        reason: "settlement_review_required",
        lastProviderOperation: "settle",
        sanitizedSettleReason:
          err instanceof Error ? sanitizeReason(err.message) : undefined,
        payer: verifyRes.payer,
        requirements,
      };
    }

    const payer = settleRes.payer || verifyRes.payer;

    if (settleRes.status === "pending") {
      const tx = String(settleRes.transaction || "").trim();
      if (!tx) {
        return {
          ok: false,
          reason: "settlement_review_required",
          lastProviderOperation: "settle",
          sanitizedSettleReason: "pending_without_tx",
          payer,
          requirements,
        };
      }
      for (const delay of SETTLE_POLL_DELAYS_MS) {
        await sleep(delay);
        try {
          const status = await client.getSettleStatus(tx);
          if (
            status.status === "success" ||
            (status.success &&
              status.status !== "failed" &&
              status.status !== "pending")
          ) {
            const settlementRef = String(status.transaction || tx).trim();
            if (settlementRef) {
              return {
                ok: true,
                settlementRef,
                verifiedVia: "okx-seller",
                payer: status.payer || payer,
                network: status.network,
                requirements,
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
              requirements,
            };
          }
        } catch {
          /* keep pending */
        }
      }
      return {
        ok: false,
        reason: "settlement_pending",
        pendingTxHash: tx,
        payer,
        lastProviderOperation: "settle",
        requirements,
      };
    }

    if (settleRes.status === "timeout") {
      const tx = String(settleRes.transaction || "").trim();
      if (tx) {
        try {
          const status = await client.getSettleStatus(tx);
          if (
            status.status === "success" ||
            (status.success && status.status !== "failed")
          ) {
            return {
              ok: true,
              settlementRef: String(status.transaction || tx).trim(),
              verifiedVia: "okx-seller",
              payer: status.payer || payer,
              network: status.network,
              requirements,
            };
          }
          if (status.status === "pending") {
            return {
              ok: false,
              reason: "settlement_pending",
              pendingTxHash: tx,
              payer,
              lastProviderOperation: "settle_status",
              requirements,
            };
          }
        } catch {
          return {
            ok: false,
            reason: "settlement_unknown",
            pendingTxHash: tx,
            payer,
            lastProviderOperation: "settle_status",
            requirements,
          };
        }
      }
      return {
        ok: false,
        reason: tx ? "settlement_unknown" : "settlement_review_required",
        pendingTxHash: tx || undefined,
        payer,
        lastProviderOperation: "settle",
        sanitizedSettleReason: "timeout",
        requirements,
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
        requirements,
      };
    }

    return {
      ok: true,
      settlementRef: String(settleRes.transaction),
      verifiedVia: "okx-seller",
      payer,
      network: settleRes.network,
      amount: settleRes.amount,
      requirements,
    };
  }

  return {
    label: "okx-seller",
    getLastRequirements: () => lastRequirements,
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
      if (detailed.reason === "settlement_review_required") {
        return {
          ok: false,
          reason: "settlement_review_required",
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
