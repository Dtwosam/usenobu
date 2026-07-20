"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getWebDatabase, markCookieHydrated } from "./db.js";
import {
  hydrateDatabaseFromCookie,
  persistDatabaseToCookie,
} from "./session-snapshot.js";
import {
  applySessionCookie,
  establishSession,
  logoutCurrentSession,
  requestMagicLinkLogin,
  rotateGuestCookie,
  verifyMagicLinkToken,
} from "../auth/service.js";
import { getSessionOwner } from "./session-owner.js";
import { isValidEmail, normalizeEmail } from "../auth/crypto.js";
import { AUTH_RESEND_COOLDOWN_SECONDS } from "../auth/config.js";

async function prepareAuthDb() {
  const db = getWebDatabase();
  markCookieHydrated(false);
  await hydrateDatabaseFromCookie(db);
  return db;
}

function rethrowIfNavigation(err: unknown): void {
  if (isRedirectError(err)) throw err;
  if (
    err &&
    typeof err === "object" &&
    "digest" in err &&
    String((err as { digest?: string }).digest).includes("NEXT_REDIRECT")
  ) {
    throw err;
  }
}

export type RequestLoginActionResult =
  | { ok: true; resend_after_seconds: number }
  | {
      ok: false;
      error:
        | "invalid_email"
        | "rate_limited"
        | "not_configured"
        | "send_failed"
        | "server_error";
    };

export async function requestLoginAction(
  formData: FormData,
): Promise<RequestLoginActionResult> {
  try {
    const email = String(formData.get("email") ?? "");
    if (!isValidEmail(email)) {
      return { ok: false, error: "invalid_email" };
    }

    const db = await prepareAuthDb();
    const guest = await getSessionOwner();
    const result = await requestMagicLinkLogin({
      db,
      email,
      guestOwnerRef: guest,
    });

    // Persist any token rows into cookie snapshot on Vercel
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));

    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return {
      ok: true,
      resend_after_seconds:
        result.resend_after_seconds ?? AUTH_RESEND_COOLDOWN_SECONDS,
    };
  } catch (err) {
    rethrowIfNavigation(err);
    console.error("requestLoginAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "server_error" };
  }
}

/**
 * Complete magic-link verification from route handler.
 * Returns redirect path (never exposes token errors raw).
 */
export async function completeMagicLinkVerification(rawToken: string): Promise<{
  redirectTo: string;
}> {
  const db = await prepareAuthDb();
  const guest = await getSessionOwner();
  const verified = verifyMagicLinkToken({
    db,
    rawToken,
    guestOwnerRef: guest,
  });

  if (!verified.ok) {
    const code =
      verified.error === "expired"
        ? "expired"
        : verified.error === "used"
          ? "used"
          : "invalid";
    return { redirectTo: `/sign-in?error=${code}` };
  }

  const { rawSessionToken } = establishSession({
    db,
    accountId: verified.account_id,
  });
  await applySessionCookie(rawSessionToken);

  // Invalidate prior guest identity so transferred rows are no longer guest-owned.
  await rotateGuestCookie();

  await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));

  if (verified.claimed > 0) {
    return {
      redirectTo: `/dashboard?claimed=${verified.claimed}`,
    };
  }
  return { redirectTo: "/dashboard" };
}

export async function logoutAction(): Promise<void> {
  try {
    const db = await prepareAuthDb();
    await logoutCurrentSession(db);
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
  } catch (err) {
    rethrowIfNavigation(err);
    console.error("logoutAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  redirect("/?signed_out=1");
}

/** Test/e2e only — completes login with captured token (no email provider). */
export async function completeTestLoginAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) redirect("/sign-in?error=invalid");

  // Dynamic import keeps production bundle free of test helpers when unused
  const { peekLastCapturedToken } = await import("../auth/email.js");
  const { isAuthTestMode } = await import("../auth/config.js");
  if (!isAuthTestMode()) {
    redirect("/sign-in?error=invalid");
  }
  const token = peekLastCapturedToken(email);
  if (!token) redirect("/sign-in?error=invalid");
  const result = await completeMagicLinkVerification(token);
  redirect(result.redirectTo);
}
