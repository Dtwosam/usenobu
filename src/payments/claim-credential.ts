/**
 * Recoverable Monitoring Pass claim credentials.
 *
 * Design: deterministic HMAC-SHA256 derived from server secret + payment id +
 * continuation id. The raw credential is never stored; only sha256(raw) is
 * kept for consume checks. Repeated successful payment replay can re-derive
 * the same unconsumed credential until the journey is created.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "../auth/crypto.js";
import { getSessionSecret, isAuthTestMode } from "../auth/config.js";

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

function claimHmacSecret(env: EnvRecord = process.env): string | null {
  const dedicated = String(
    env.NOBU_PASS_CLAIM_SECRET || env.PASS_CLAIM_SECRET || "",
  ).trim();
  if (dedicated.length >= 16) return dedicated;
  const session = getSessionSecret(env);
  if (session) return session;
  if (isAuthTestMode(env)) {
    return "nobu-test-pass-claim-secret-do-not-use-in-prod";
  }
  return null;
}

/**
 * Derive the single-use claim credential for a payment/continuation pair.
 * Returns null if no server secret is configured (fail closed).
 */
export function derivePassClaimCredential(args: {
  paymentId: string;
  continuationId: string;
  env?: EnvRecord;
}): { raw: string; hash: string } | null {
  const secret = claimHmacSecret(args.env ?? process.env);
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
