/**
 * Recoverable Monitoring Pass claim credentials.
 *
 * Deterministic HMAC-SHA256 from dedicated NOBU_PASS_CLAIM_SECRET + payment id +
 * continuation id. Raw credential is never stored; only sha256(raw) is kept.
 * Repeated successful payment replay re-derives the same unconsumed credential.
 *
 * No silent fallback to rotating session secrets (fail closed without dedicated secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "../auth/crypto.js";
import { isAuthTestMode } from "../auth/config.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** Test-only dedicated secret — never used in production. */
export const TEST_PASS_CLAIM_SECRET =
  "nobu-test-pass-claim-secret-v1-do-not-use-in-prod";

/**
 * Resolve the dedicated claim HMAC secret.
 * Production: NOBU_PASS_CLAIM_SECRET only (>=16 chars).
 * Test mode: NOBU_PASS_CLAIM_SECRET or stable test default.
 * Never falls back to SESSION_SECRET.
 */
export function resolvePassClaimSecret(
  env: EnvRecord = process.env,
): string | null {
  const dedicated = String(env.NOBU_PASS_CLAIM_SECRET || "").trim();
  if (dedicated.length >= 16) return dedicated;
  if (isAuthTestMode(env)) {
    // Allow empty override for fail-closed tests via NOBU_PASS_CLAIM_SECRET=""
    if (env.NOBU_PASS_CLAIM_SECRET === "") return null;
    return TEST_PASS_CLAIM_SECRET;
  }
  return null;
}

export function isPassClaimSecretConfigured(
  env: EnvRecord = process.env,
): boolean {
  return resolvePassClaimSecret(env) !== null;
}

/**
 * Derive the single-use claim credential for a payment/continuation pair.
 * Returns null if no dedicated claim secret is configured (fail closed).
 */
export function derivePassClaimCredential(args: {
  paymentId: string;
  continuationId: string;
  env?: EnvRecord;
}): { raw: string; hash: string } | null {
  const secret = resolvePassClaimSecret(args.env ?? process.env);
  if (!secret) return null;
  const paymentId = String(args.paymentId || "").trim();
  const continuationId = String(args.continuationId || "").trim();
  if (!paymentId || !continuationId) return null;
  const mac = createHmac("sha256", secret)
    .update(`nobu_pass_claim_v1|${paymentId}|${continuationId}`)
    .digest("base64url");
  const raw = `pass_claim_${mac}`;
  return { raw, hash: sha256Hex(raw) };
}

export function hashPassClaimCredential(raw: string): string {
  return sha256Hex(String(raw || "").trim());
}

export function safeEqualClaimHash(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
