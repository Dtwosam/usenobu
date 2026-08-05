/**
 * x402 challenge/verification boundary.
 *
 * Uses official @okxweb3/x402-core HTTP primitives for challenge and
 * PAYMENT-RESPONSE receipt encoding. Production verification uses the OKX
 * seller HTTP adapter (verify → settle → settle/status). Test mode may inject
 * a fake verifier.
 *
 * Locked MVP terms (do not change without ASP re-registration):
 *   x402Version 2, exact scheme, eip155:196, USD₮0 amount 990000.
 */
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  decodePaymentSignatureHeader,
} from "@okxweb3/x402-core/http";
import { isAuthTestMode } from "../auth/config.js";
import { isOkxSellerConfigured, loadOkxSellerConfig } from "./okx-seller-client.js";
import { createOkxSellerVerifier } from "./okx-seller-verifier.js";

/** Official OKX x402 version. */
export const X402_VERSION = 2;
/** Header the client must replay the signed payment authorization under. */
export const X402_PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";
/** Header Nobu returns the encoded challenge under on a 402 response. */
export const X402_CHALLENGE_HEADER_NAME = "PAYMENT-REQUIRED";
/** Header Nobu returns after confirmed settlement (official receipt). */
export const X402_PAYMENT_RESPONSE_HEADER_NAME = "PAYMENT-RESPONSE";

/**
 * Official X Layer / USD₮0 worked example (OKX payments docs + okx/payments).
 */
export const DEFAULT_SETTLEMENT_NETWORK = "eip155:196";
export const DEFAULT_SETTLEMENT_ASSET =
  "0x779ded0c9e1022225f8e0630b35a9b54be713736";
export const DEFAULT_SETTLEMENT_DECIMALS = 6;
/** $0.99 at 6 decimals. */
export const MONITORING_PRICE_ATOMIC_UNITS = "990000";
export const MONITORING_PRICE_USD = 0.99;

/**
 * EIP-712 domain metadata the buyer needs to sign `exact` + EIP-3009.
 *
 * `name` is the literal on-chain `name()` of the settlement asset, read from
 * the X Layer contract rather than assumed: 7 UTF-8 bytes
 * `55 53 44 e2 82 ae 30` = U+0055 U+0053 U+0044 U+20AE U+0030 = "USD₮0".
 * The contract implements no `version()` / `eip712Domain()`, so the official
 * default documented for the `exact` scheme applies ("version optional,
 * defaults \"2\"").
 */
export const SETTLEMENT_ASSET_EIP712_NAME = "USD₮0";
export const SETTLEMENT_ASSET_EIP712_VERSION = "2";

/** Window the buyer has to sign and replay before the challenge is stale. */
export const X402_MAX_TIMEOUT_SECONDS = 300;

export interface X402AcceptOption {
  scheme: string;
  network: string;
  asset: string;
  /** Atomic units, string per the official convention. */
  amount: string;
  /** Seller wallet — from server env only (never client-supplied). */
  payTo: string | null;
  maxTimeoutSeconds: number;
  extra: Record<string, string>;
}

/** x402 v2 carries a resource object; only legacy v1 used a bare string. */
export interface X402Resource {
  url: string;
  description: string;
  mimeType: string;
}

export interface X402Challenge {
  x402Version: number;
  resource: X402Resource;
  accepts: X402AcceptOption[];
}

export interface BuildX402ChallengeArgs {
  /** Absolute HTTPS URL of the paid resource. */
  resource: string;
  /** Accurate, human-readable description of exactly what is bought. */
  description: string;
  /** Quote-bound challenges carry the quote id; the Monitoring Pass does not. */
  quoteId?: string;
  payTo?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Optional facilitator-supported kind extras to merge into EIP-712 domain. */
  supportedKindExtra?: Record<string, unknown> | null;
}

/**
 * Builds an x402 v2 challenge. Amount, asset, network and payTo are always
 * server-controlled; a quote id is included only when the challenge is bound
 * to one specific enrollment quote.
 */
export function buildX402Challenge(
  args: BuildX402ChallengeArgs,
): X402Challenge {
  const env = args.env ?? process.env;
  const cfg = loadOkxSellerConfig(env);
  const payTo =
    args.payTo !== undefined ? args.payTo : (cfg?.payTo ?? null);
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
        payTo,
        maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
        extra: buildSettlementExtra(args.quoteId, args.supportedKindExtra),
      },
    ],
  };
}

/** EIP-712 domain metadata, plus the quote binding when there is one. */
export function buildSettlementExtra(
  quoteId?: string,
  supportedKindExtra?: Record<string, unknown> | null,
): Record<string, string> {
  const extra: Record<string, string> = {
    name: SETTLEMENT_ASSET_EIP712_NAME,
    version: SETTLEMENT_ASSET_EIP712_VERSION,
  };
  // Merge safe string extras from facilitator supported-kind (EIP-712 enrichment).
  if (supportedKindExtra && typeof supportedKindExtra === "object") {
    for (const [k, v] of Object.entries(supportedKindExtra)) {
      if (typeof v === "string" && v.length > 0 && v.length < 128) {
        // Never let facilitator override locked amount/network/asset via extra.
        if (k === "name" || k === "version" || k === "decimals") {
          extra[k] = v;
        }
      }
      if (typeof v === "number" && k === "decimals") {
        extra[k] = String(v);
      }
    }
  }
  // Locked domain wins over facilitator if conflicted on name/version for USD₮0.
  extra.name = SETTLEMENT_ASSET_EIP712_NAME;
  extra.version = SETTLEMENT_ASSET_EIP712_VERSION;
  if (quoteId) extra.quote_id = quoteId;
  return extra;
}

/**
 * Encode challenge as PAYMENT-REQUIRED header value.
 * Prefer official SDK encoder (PaymentRequired shape); fall back to base64 JSON.
 */
export function encodeX402ChallengeHeader(challenge: X402Challenge): string {
  try {
    // Official PaymentRequired: { x402Version, error?, resource, accepts }
    return encodePaymentRequiredHeader(
      challenge as unknown as Parameters<typeof encodePaymentRequiredHeader>[0],
    );
  } catch {
    return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64");
  }
}

/**
 * Encode a safe settlement receipt as PAYMENT-RESPONSE.
 * Never includes raw payment signatures or authorization payloads.
 */
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

/**
 * Decode PAYMENT-SIGNATURE via official SDK when possible.
 * Returns null on malformed input. Never logs the raw value.
 */
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
      // Fall through to base64/base64url JSON parse
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
  /** Absent for a Monitoring Pass, which binds to no quote. */
  quoteId?: string;
  /** Raw header value from the client's replay — never persisted or logged. */
  authorizationHeader: string;
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
        | "rejected";
      pendingTxHash?: string;
      payer?: string;
      sanitizedReason?: string;
    };

export interface X402Verifier {
  readonly label: string;
  verifyPayment(input: X402VerifyInput): Promise<X402VerifyResult>;
}

/**
 * Always fails closed when seller credentials / payTo are absent.
 */
export const notConfiguredVerifier: X402Verifier = {
  label: "not-configured",
  async verifyPayment(): Promise<X402VerifyResult> {
    return { ok: false, reason: "not_configured" };
  },
};

export interface ResolveVerifierArgs {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Tests only. Ignored (throws) unless isAuthTestMode(env). */
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
