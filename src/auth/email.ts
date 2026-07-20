/**
 * Magic-link email delivery.
 * Production: Resend HTTP API (or EMAIL_PROVIDER_API_KEY compatible).
 * Tests: capture links in-memory + sqlite — never require a real inbox.
 */
import { isAuthTestMode } from "./config.js";

export type MagicLinkEmailPayload = {
  /** Recipient — never log this value. */
  to: string;
  verifyUrl: string;
  expiresMinutes: number;
};

type Captured = {
  toHash: string;
  verifyUrl: string;
  rawToken: string;
  at: string;
};

const testCaptures = new Map<string, Captured>();

/** Test/e2e only — keyed by normalized email. */
export function getCapturedMagicLink(
  emailNormalized: string,
): Captured | null {
  return testCaptures.get(emailNormalized) ?? null;
}

export function clearCapturedMagicLinks(): void {
  testCaptures.clear();
}

export function peekLastCapturedToken(emailNormalized: string): string | null {
  return testCaptures.get(emailNormalized)?.rawToken ?? null;
}

/** Prefer memory, then durable sqlite test table (e2e multi-isolate). */
export async function peekLastCapturedTokenAsync(
  emailNormalized: string,
): Promise<string | null> {
  const mem = peekLastCapturedToken(emailNormalized);
  if (mem) return mem;
  try {
    const { getWebDatabase } = await import("../web/db.js");
    const db = getWebDatabase();
    const row = db
      .prepare(
        `SELECT raw_token FROM auth_test_tokens WHERE email_normalized = ?`,
      )
      .get(emailNormalized) as { raw_token: string } | undefined;
    return row?.raw_token ?? null;
  } catch {
    return null;
  }
}

function hashEmail(email: string): string {
  // short opaque marker for diagnostics (not reversible identity in logs)
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) | 0;
  return `e${(h >>> 0).toString(16)}`;
}

export type SendMagicLinkResult =
  | { ok: true; mode: "test" | "resend" | "dev_log" }
  | { ok: false; error: "not_configured" | "provider_error" };

/**
 * Send magic link. Never throws account-existence signals.
 * rawToken is only stored in test capture, never logged.
 */
export async function sendMagicLinkEmail(args: {
  emailNormalized: string;
  verifyUrl: string;
  rawToken: string;
  expiresMinutes?: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): Promise<SendMagicLinkResult> {
  const env = args.env ?? process.env;
  const expiresMinutes = args.expiresMinutes ?? 15;

  if (isAuthTestMode(env)) {
    testCaptures.set(args.emailNormalized, {
      toHash: hashEmail(args.emailNormalized),
      verifyUrl: args.verifyUrl,
      rawToken: args.rawToken,
      at: new Date().toISOString(),
    });
    // Also persist for multi-worker Next/e2e (in-memory map is process-local).
    try {
      const { getWebDatabase } = await import("../web/db.js");
      const db = getWebDatabase();
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_test_tokens (
          email_normalized TEXT PRIMARY KEY NOT NULL,
          raw_token TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.prepare(
        `INSERT INTO auth_test_tokens (email_normalized, raw_token, created_at)
         VALUES (?,?,?)
         ON CONFLICT(email_normalized) DO UPDATE SET
           raw_token = excluded.raw_token,
           created_at = excluded.created_at`,
      ).run(args.emailNormalized, args.rawToken, new Date().toISOString());
    } catch {
      /* ignore */
    }
    return { ok: true, mode: "test" };
  }

  const apiKey = String(
    env.RESEND_API_KEY || env.EMAIL_PROVIDER_API_KEY || "",
  ).trim();
  const from = String(
    env.EMAIL_FROM_ADDRESS || env.AUTH_EMAIL_FROM || "",
  ).trim();

  if (!apiKey || !from) {
    // Dev fallback: allow local without provider when not production
    if (env.NODE_ENV !== "production" && env.VERCEL !== "1") {
      console.info("nobu_auth_magic_link_dev", {
        // no email, no token
        email_hash: hashEmail(args.emailNormalized),
        has_url: Boolean(args.verifyUrl),
      });
      testCaptures.set(args.emailNormalized, {
        toHash: hashEmail(args.emailNormalized),
        verifyUrl: args.verifyUrl,
        rawToken: args.rawToken,
        at: new Date().toISOString(),
      });
      return { ok: true, mode: "dev_log" };
    }
    return { ok: false, error: "not_configured" };
  }

  try {
    const subject = "Your Nobu sign-in link";
    const text = [
      "Sign in to Nobu with this secure one-time link:",
      "",
      args.verifyUrl,
      "",
      `This link expires in about ${expiresMinutes} minutes and can only be used once.`,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [args.emailNormalized],
        subject,
        text,
      }),
    });

    if (!res.ok) {
      console.error("nobu_auth_email_provider_error", {
        status: res.status,
        // no body dump (may contain PII)
      });
      return { ok: false, error: "provider_error" };
    }
    return { ok: true, mode: "resend" };
  } catch (err) {
    console.error("nobu_auth_email_send_failed", {
      message: err instanceof Error ? err.message : "send_failed",
    });
    return { ok: false, error: "provider_error" };
  }
}
