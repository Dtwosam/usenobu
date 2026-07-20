/**
 * x402 challenge/verification boundary.
 *
 * Lane 8R.0: production uses the official OKX seller HTTP adapter
 * (verify → settle → settle/status). Test mode may inject a fake verifier.
 *
 * Challenge shape matches OKX x402 v2 + exact scheme on X Layer USD₮0.
 */
import { isAuthTestMode } from "../auth/config.js";
import { isOkxSellerConfigured, loadOkxSellerConfig } from "./okx-seller-client.js";
import { createOkxSellerVerifier } from "./okx-seller-verifier.js";

/** Official OKX x402 version. */
export const X402_VERSION = 2;
/** Header the client must replay the signed payment authorization under. */
export const X402_PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";
/** Header Nobu returns the encoded challenge under on a 402 response. */
export const X402_CHALLENGE_HEADER_NAME = "PAYMENT-REQUIRED";

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

export interface X402AcceptOption {
  scheme: string;
  network: string;
  asset: string;
  /** Atomic units, string per the official convention. */
  amount: string;
  resource: string;
  /** Seller wallet — from server env only (never client-supplied). */
  payTo: string | null;
  extra: { quote_id: string };
}

export interface X402Challenge {
  x402Version: number;
  resource: string;
  accepts: X402AcceptOption[];
}

/** Builds a challenge bound to one specific quote and resource — never reusable across quotes. */
export function buildX402Challenge(args: {
  resource: string;
  quoteId: string;
  payTo?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): X402Challenge {
  const env = args.env ?? process.env;
  const cfg = loadOkxSellerConfig(env);
  const payTo =
    args.payTo !== undefined
      ? args.payTo
      : (cfg?.payTo ?? null);
  return {
    x402Version: X402_VERSION,
    resource: args.resource,
    accepts: [
      {
        scheme: "exact",
        network: DEFAULT_SETTLEMENT_NETWORK,
        asset: DEFAULT_SETTLEMENT_ASSET,
        amount: MONITORING_PRICE_ATOMIC_UNITS,
        resource: args.resource,
        payTo,
        extra: { quote_id: args.quoteId },
      },
    ],
  };
}

export function encodeX402ChallengeHeader(challenge: X402Challenge): string {
  return Buffer.from(JSON.stringify(challenge), "utf8").toString("base64url");
}

export interface X402VerifyInput {
  resource: string;
  quoteId: string;
  /** Raw header value from the client's replay — never persisted or logged. */
  authorizationHeader: string;
}

export type X402VerifyResult =
  | { ok: true; settlementRef: string; verifiedVia: string }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_configured"
        | "provider_error"
        | "amount_mismatch"
        | "resource_mismatch";
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
