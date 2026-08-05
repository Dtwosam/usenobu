/**
 * Canonical settlement transaction reference.
 * One format for facilitator queries, claims, payments, passes, and audits.
 */

/** Hex 0x-prefixed transaction hash, minimum 16 hex digits after 0x. */
const TX_RE = /^0x[a-f0-9]{16,}$/;

/**
 * Trim, validate hex format, and lowercase.
 * Returns null when the input is not a usable transaction reference.
 */
export function canonicalizeSettlementRef(
  raw: string | null | undefined,
): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (!TX_RE.test(lower)) return null;
  return lower;
}

export function isCanonicalSettlementRef(value: string): boolean {
  return TX_RE.test(String(value || ""));
}
