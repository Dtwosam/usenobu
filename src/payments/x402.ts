/**
 * x402 challenge/verification boundary.
 *
 * Challenge and verify/settle share one canonical PaymentRequirements object
 * from `canonical-requirements.ts` (ExactEvmScheme-enhanced).
 */
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@okxweb3/x402-core/http";
import { isAuthTestMode } from "../auth/config.js";
import { isOkxSellerConfigured, loadOkxSellerConfig } from "./okx-seller-client.js";
import { createOkxSellerVerifier } from "./okx-seller-verifier.js";
import {
  buildCanonicalPaymentRequired,
  buildCanonicalPaymentRequirements,
  type CanonicalPaymentRequirements,
  type CanonicalPaymentRequired,
  resolvePayTo,
} from "./canonical-requirements.js";

export const X402_VERSION = 2;
export const X402_PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";
export const X402_CHALLENGE_HEADER_NAME = "PAYMENT-REQUIRED";
export const X402_PAYMENT_RESPONSE_HEADER_NAME = "PAYMENT-RESPONSE";

export const DEFAULT_SETTLEMENT_NETWORK = "eip155:196";
export const DEFAULT_SETTLEMENT_ASSET =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const DEFAULT_SETTLEMENT_DECIMALS = 6;
export const MONITORING_PRICE_ATOMIC_UNITS = "990000";
export const MONITORING_PRICE_USD = 0.99;

/** @deprecated Prefer ExactEvmScheme / getDefaultAsset via canonical-requirements. */
export const SETTLEMENT_ASSET_EIP712_NAME = "USD₮0";
/** Official package getDefaultAsset for eip155:196 uses version "1". */
export const SETTLEMENT_ASSET_EIP712_VERSION = "1";

export const X402_MAX_TIMEOUT_SECONDS = 300;

export type X402AcceptOption = CanonicalPaymentRequirements;

export interface X402Resource {
  url: string;
  description: string;
  mimeType: string;
}

export type X402Challenge = CanonicalPaymentRequired;

export interface BuildX402ChallengeArgs {
  resource: string;
  description: string;
  quoteId?: string;
  payTo?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Ignored — supported-kind must not diverge challenge from verify. */
  supportedKindExtra?: Record<string, unknown> | null;
}

/**
 * Synchronous challenge builder for tests that only need locked commercial
 * fields. Prefer `buildX402ChallengeAsync` in production paths.
 */
export function buildX402Challenge(args: BuildX402ChallengeArgs): X402Challenge {
  const env = args.env ?? process.env;
  const payTo =
    args.payTo !== undefined
      ? args.payTo
      : (loadOkxSellerConfig(env)?.payTo ?? null);
  // Sync fallback: commercial fields only; extra filled by async path in prod.
  // Tests that need full equality should use buildX402ChallengeAsync.
  const extra: Record<string, unknown> = {
    name: SETTLEMENT_ASSET_EIP712_NAME,
    version: SETTLEMENT_ASSET_EIP712_VERSION,
  };
  if (args.quoteId) extra.quote_id = args.quoteId;
  return {
    x402Version: X402_VERSION,
    resource: {
      url: args.resource,
      description: args.description,
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: DEFAULT_SETTLEMENT_NETWORK,
        asset: DEFAULT_SETTLEMENT_ASSET,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        payTo: payTo ?? "",
        maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
        extra,
      },
    ],
  };
}

/** Production challenge builder — identical requirements for challenge + settle. */
export async function buildX402ChallengeAsync(
  args: BuildX402ChallengeArgs,
): Promise<{
  challenge: X402Challenge;
  requirements: CanonicalPaymentRequirements;
}> {
  const env = args.env ?? process.env;
  const payTo = resolvePayTo(env, args.payTo);
  if (!payTo) {
    // Fail-closed shape still valid for unpaid challenge when payTo missing
    // (x402-check may still inspect structure); verify will fail closed later.
    const challenge = buildX402Challenge(args);
    return {
      challenge,
      requirements: challenge.accepts[0] as CanonicalPaymentRequirements,
    };
  }
  const built = await buildCanonicalPaymentRequired({
    resourceUrl: args.resource,
    description: args.description,
    payTo,
    quoteId: args.quoteId,
  });
  return {
    challenge: built.paymentRequired,
    requirements: built.requirements,
  };
}

/** @deprecated Use ExactEvmScheme via canonical-requirements. */
export function buildSettlementExtra(
  quoteId?: string,
  _supportedKindExtra?: Record<string, unknown> | null,
): Record<string, string> {
  const extra: Record<string, string> = {
    name: SETTLEMENT_ASSET_EIP712_NAME,
    version: SETTLEMENT_ASSET_EIP712_VERSION,
  };
  if (quoteId) extra.quote_id = quoteId;
  return extra;
}

export function encodeX402ChallengeHeader(challenge: X402Challenge): string {
  try {
    return encodePaymentRequiredHeader(
      challenge as unknown as Parameters<typeof encodePaymentRequiredHeader>[0],
    );
  } catch {
    return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
  }
}

export function encodeX402PaymentResponseHeader(args: {
  success: boolean;
  transaction: string;
  network?: string;
  payer?: string;
  status?: "pending" | "success" | "timeout";
  amount?: string;
  errorReason?: string;
}): string {
  const body = {
    success: args.success,
    transaction: args.transaction || "",
    network: args.network ?? DEFAULT_SETTLEMENT_NETWORK,
    ...(args.payer ? { payer: args.payer } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(args.amount ? { amount: args.amount } : {}),
    ...(args.errorReason ? { errorReason: args.errorReason } : {}),
  };
  return encodePaymentResponseHeader(
    body as unknown as Parameters<typeof encodePaymentResponseHeader>[0],
  );
}

export function decodePaymentSignatureHeaderSafe(
  authorizationHeader: string,
): Record<string, unknown> | null {
  const raw = String(authorizationHeader || "").trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("{")) {
      const obj = JSON.parse(raw) as unknown;
      if (obj && typeof obj === "object") return obj as Record<string, unknown>;
      return null;
    }
    try {
      const decoded = decodePaymentSignatureHeader(raw);
      if (decoded && typeof decoded === "object") {
        return decoded as unknown as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = Buffer.from(b64 + pad, "base64").toString("utf8");
    const obj = JSON.parse(json) as unknown;
    if (obj && typeof obj === "object") return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export interface X402VerifyInput {
  resource: string;
  quoteId?: string;
  authorizationHeader: string;
  /** When provided, must be the same object used for the challenge accepts[0]. */
  requirements?: CanonicalPaymentRequirements;
}

export type X402VerifyResult =
  | { ok: true; settlementRef: string; verifiedVia: string; payer?: string }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_configured"
        | "provider_error"
        | "amount_mismatch"
        | "resource_mismatch"
        | "settlement_pending"
        | "settlement_unknown"
        | "settlement_review_required"
        | "rejected";
      pendingTxHash?: string;
      payer?: string;
      sanitizedReason?: string;
    };

export interface X402Verifier {
  readonly label: string;
  verifyPayment(input: X402VerifyInput): Promise<X402VerifyResult>;
}

export const notConfiguredVerifier: X402Verifier = {
  label: "not-configured",
  async verifyPayment(): Promise<X402VerifyResult> {
    return { ok: false, reason: "not_configured" };
  },
};

export interface ResolveVerifierArgs {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  testVerifier?: X402Verifier;
}

export function resolveX402Verifier(
  args: ResolveVerifierArgs = {},
): X402Verifier {
  const env = args.env ?? process.env;
  if (args.testVerifier) {
    if (!isAuthTestMode(env)) {
      throw new Error("x402_test_verifier_forbidden_outside_test_mode");
    }
    return args.testVerifier;
  }
  if (isOkxSellerConfigured(env)) {
    return createOkxSellerVerifier({ env });
  }
  return notConfiguredVerifier;
}

export { buildCanonicalPaymentRequirements };
