/**
 * Auth configuration — server-only secrets.
 */
export const AUTH_SESSION_COOKIE = "nobu_auth_session_v1";
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTH_LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const AUTH_RESEND_COOLDOWN_SECONDS = 45;
export const AUTH_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const AUTH_RATE_LIMIT_MAX = 8; // requests per email per window

export const ACCOUNT_ID_RE = /^acct_[a-f0-9]{32}$/;

export function isAuthTestMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (env.NOBU_AUTH_TEST_MODE === "1") return true;
  if (env.VITEST === "true" || env.NODE_ENV === "test") return true;
  return false;
}

export function getSessionSecret(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const s = String(env.SESSION_SECRET || env.NOBU_SESSION_SECRET || "").trim();
  if (s.length >= 16) return s;
  if (isAuthTestMode(env)) {
    return "nobu-test-session-secret-do-not-use-in-prod";
  }
  return null;
}

export function getAppBaseUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw =
    env.APP_BASE_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "") ||
    "http://127.0.0.1:3456";
  return raw.replace(/\/$/, "");
}

export function isEmailDeliveryConfigured(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  if (isAuthTestMode(env)) return true;
  const key = String(env.RESEND_API_KEY || env.EMAIL_PROVIDER_API_KEY || "").trim();
  const from = String(env.EMAIL_FROM_ADDRESS || env.AUTH_EMAIL_FROM || "").trim();
  return Boolean(key && from);
}

/** Manual setup still required when production email is not configured. */
export function authManualActionsRequired(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  const missing: string[] = [];
  if (!getSessionSecret(env) && !isAuthTestMode(env)) {
    missing.push("SESSION_SECRET (>=16 chars, server-only)");
  }
  if (!isEmailDeliveryConfigured(env) && !isAuthTestMode(env)) {
    missing.push("RESEND_API_KEY (or EMAIL_PROVIDER_API_KEY)");
    missing.push("EMAIL_FROM_ADDRESS (verified sender)");
    missing.push("APP_BASE_URL (public HTTPS origin for magic links)");
  }
  return missing;
}
