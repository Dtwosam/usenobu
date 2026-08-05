/**
 * Sanitize opaque provider payment / authorization identifiers for durable storage.
 * Never stores signatures, authorization payloads, wallet secrets, or full response bodies.
 */

const MAX_PROVIDER_ID_LENGTH = 200;

/**
 * Normalize whitespace only. Do not lowercase unless the provider contract says
 * the identifier is case-insensitive (it does not today).
 */
export function sanitizeProviderId(
  value: unknown,
  maxLen: number = MAX_PROVIDER_ID_LENGTH,
): string | null {
  if (value == null) return null;
  const raw = String(value).trim().replace(/\s+/g, " ");
  if (!raw) return null;
  // Reject anything that looks like a raw payment signature / large payload.
  if (raw.length > maxLen) return raw.slice(0, maxLen);
  // Never persist obvious JWT/base64url payment headers or multi-kb blobs.
  if (raw.includes("eyJ") && raw.length > 80) return null;
  if (raw.startsWith("{") || raw.startsWith("[")) return null;
  return raw;
}

/** Extract provider payment id from verify / settle / status-shaped objects. */
export function extractProviderPaymentId(
  source: Record<string, unknown> | null | undefined,
): string | null {
  if (!source || typeof source !== "object") return null;
  return (
    sanitizeProviderId(source.paymentId) ??
    sanitizeProviderId(source.payment_id)
  );
}

/** Extract provider authorization id from verify / settle / status-shaped objects. */
export function extractProviderAuthorizationId(
  source: Record<string, unknown> | null | undefined,
): string | null {
  if (!source || typeof source !== "object") return null;
  return (
    sanitizeProviderId(source.authorizationId) ??
    sanitizeProviderId(source.authorization_id)
  );
}

export type ProviderIds = {
  providerPaymentId: string | null;
  providerAuthorizationId: string | null;
};

export function extractProviderIds(
  ...sources: Array<Record<string, unknown> | null | undefined>
): ProviderIds {
  let providerPaymentId: string | null = null;
  let providerAuthorizationId: string | null = null;
  for (const s of sources) {
    if (!providerPaymentId) {
      providerPaymentId = extractProviderPaymentId(s);
    }
    if (!providerAuthorizationId) {
      providerAuthorizationId = extractProviderAuthorizationId(s);
    }
  }
  return { providerPaymentId, providerAuthorizationId };
}
