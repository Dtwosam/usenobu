/**
 * Pure navigation helpers (not Server Actions).
 */

/** Valid demo purchase ids look like pur_<8–32 hex>. */
export function isValidPurchaseId(id: unknown): id is string {
  return typeof id === "string" && /^pur_[a-f0-9]{8,32}$/i.test(id);
}

/** Build review path only for a real purchase id; never invent routes. */
export function buildReviewRedirectPath(
  purchaseId: string,
  query: URLSearchParams,
): string | null {
  if (!isValidPurchaseId(purchaseId)) return null;
  const qs = query.toString();
  return qs
    ? `/purchases/${purchaseId}/review?${qs}`
    : `/purchases/${purchaseId}/review`;
}
