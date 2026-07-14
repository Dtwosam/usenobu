/**
 * Explicit boundary: fixtures never silently run on the production manual-check path.
 *
 * Allowed for fixtures:
 * - Automated tests (NODE_ENV=test / VITEST)
 * - Explicit NOBU_FIXTURE_MODE=1 or NOBU_ALLOW_FIXTURE_CHECKS=1 (e2e / local proof)
 *
 * Production (Vercel) without those flags → always LIVE SerpApi.
 */

export type ManualCheckDataSource = "LIVE" | "FIXTURE";

export function isFixtureCheckAllowed(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (env.NOBU_FORCE_LIVE_CHECKS === "1") return false;
  if (env.VITEST === "true" || env.NODE_ENV === "test") return true;
  if (env.NOBU_FIXTURE_MODE === "1" || env.NOBU_ALLOW_FIXTURE_CHECKS === "1") {
    return true;
  }
  return false;
}

/**
 * Resolve data source for a manual price check.
 * Production defaults to LIVE. Fixture only with explicit allow + request.
 */
export function resolveManualCheckDataSource(args?: {
  /** Caller requests fixture path (tests / e2e only). */
  prefer_fixture?: boolean;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): ManualCheckDataSource {
  const env = args?.env ?? process.env;
  const allow = isFixtureCheckAllowed(env);
  if (args?.prefer_fixture === true) {
    return allow ? "FIXTURE" : "LIVE";
  }
  // Default: fixture only when gate is open (test/e2e); otherwise LIVE
  return allow ? "FIXTURE" : "LIVE";
}

/** UI may show the test-data label only when fixture path is active. */
export function shouldShowFixtureUiLabel(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return isFixtureCheckAllowed(env);
}

export const FIXTURE_UI_LABEL =
  "Test data — not a live current retailer price.";
