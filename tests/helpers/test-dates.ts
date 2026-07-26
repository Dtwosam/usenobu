/**
 * Deterministic, relative test dates.
 *
 * Fixtures used to pin `purchase_date` to fixed 2026-07 literals. Those dates
 * quietly aged past Target's price-adjustment window, so eligibility-gated
 * setup started returning WINDOW_EXPIRED and ~16 tests failed without any
 * code being wrong — see
 * `docs/proof/lane-8r-3b-monitoring-pass-repair/pre-existing-failures.md`.
 *
 * These helpers are relative to "now" and computed (not random), so they stay
 * inside or outside the window by intent rather than by calendar luck. They
 * change no policy logic: the window itself is still whatever
 * `src/policy/evaluate-target-policy.ts` says it is.
 */

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * A purchase recent enough to be comfortably inside Target's adjustment
 * window. Use for fixtures that need eligibility to pass.
 */
export function recentPurchaseDate(daysAgo = 3): string {
  return isoDaysAgo(daysAgo);
}

/**
 * A purchase old enough to be comfortably outside Target's adjustment window.
 * Use for fixtures that deliberately exercise the expired/ineligible path.
 */
export function expiredPurchaseDate(daysAgo = 120): string {
  return isoDaysAgo(daysAgo);
}
