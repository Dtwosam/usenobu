/**
 * Lane 7.4D — official x402 challenge/verification boundary.
 *
 * Nobu issues its own x402 v2-shaped challenge (HTTP 402 with a
 * PAYMENT-REQUIRED header carrying base64 `{x402Version, resource,
 * accepts}}`, matching the official OKX seller-side flow documented in
 * `docs/external-source-registry.md` — protected request -> 402 challenge ->
 * signed payment -> replay) and verifies a client's payment replay through a
 * swappable `X402Verifier`.
 *
 * Production has no confirmed official seller-side settlement-verification
 * contract yet — Lane 7.4D.0's research established the buyer-side signing
 * tools (the official CLI's `payment pay` / `payment charge`) but never
 * found an official endpoint/contract for a *seller* to independently
 * verify a received payment. The production verifier therefore fails
 * closed by design, not by omission: wiring a real verifier requires that
 * gap to be closed by official OKX evidence first, never guessed. Only an
 * explicitly injected, test-mode-gated fake verifier may ever report a
 * successful settlement outside a genuine future integration.
 */
import { isAuthTestMode } from "../auth/config.js";

export const X402_VERSION = 1;
/** Header the client must replay the signed payment authorization under. */
export const X402_PAYMENT_HEADER_NAME = "PAYMENT-SIGNATURE";
/** Header Nobu returns the encoded challenge under on a 402 response. */
export const X402_CHALLENGE_HEADER_NAME = "PAYMENT-REQUIRED";

/**
 * Per Lane 7.4D.0 (`OKX-XLAYER-EXAMPLE`, coordinator-provided, independently
 * corroborated by the official CLI/skills for asset family + decimals):
 * X Layer / USD₮0 official worked example. Not yet confirmed as the asset
 * Nobu's own listing will actually use — no paid listing is registered.
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
  /** Nobu's settlement address — null until a paid listing is registered (Lane 8R). */
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
}): X402Challenge {
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
        payTo: args.payTo ?? null,
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
 * Always fails closed — the correct, honest production default until an
 * official seller-side settlement-verification contract is confirmed.
 */
export const notConfiguredVerifier: X402Verifier = {
  label: "not-configured",
  async verifyPayment(): Promise<X402VerifyResult> {
    return { ok: false, reason: "not_configured" };
  },
};

export interface ResolveVerifierArgs {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Tests only. Ignored (throws) unless isAuthTestMode(env) — production can never inject a fake verifier. */
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
  return notConfiguredVerifier;
}
