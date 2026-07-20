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

async function preparePurchaseDb() {
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

    const db = await preparePurchaseDb();
    const guest = await getSessionOwner();
    const result = await requestMagicLinkLogin({
      email,
      guestOwnerRef: guest,
      sqliteDb: db,
    });

    // Purchase cookie only — never persist auth tables into the browser snapshot.
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
 * POST-only consumption of magic link (after user confirms on GET page).
 */
export async function confirmMagicLinkAction(
  formData: FormData,
): Promise<void> {
  const rawToken = String(formData.get("token") ?? "");
  try {
    const db = await preparePurchaseDb();
    const guest = await getSessionOwner();
    const verified = await verifyMagicLinkToken({
      rawToken,
      guestOwnerRef: guest,
      purchaseDb: db,
      sqliteDb: db,
    });

    if (!verified.ok) {
      const code =
        verified.error === "expired"
          ? "expired"
          : verified.error === "used"
            ? "used"
            : "invalid";
      redirect(`/sign-in?error=${code}`);
    }

    const { rawSessionToken } = await establishSession({
      accountId: verified.account_id,
      sqliteDb: db,
    });
    await applySessionCookie(rawSessionToken);
    await rotateGuestCookie();
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));

    if (verified.claimed > 0) {
      redirect(`/dashboard?claimed=${verified.claimed}`);
    }
    redirect("/dashboard");
  } catch (err) {
    rethrowIfNavigation(err);
    console.error("confirmMagicLinkAction_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    redirect("/sign-in?error=invalid");
  }
}

export async function logoutAction(): Promise<void> {
  try {
    const db = await preparePurchaseDb();
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

/** Test/e2e — request + capture token, then POST confirm. */
export async function completeTestLoginAction(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) redirect("/sign-in?error=invalid");

  const { peekLastCapturedTokenAsync } = await import("../auth/email.js");
  const { isAuthTestMode } = await import("../auth/config.js");
  if (!isAuthTestMode()) {
    redirect("/sign-in?error=invalid");
  }
  const token = await peekLastCapturedTokenAsync(email);
  if (!token) redirect("/sign-in?error=invalid");

  // Simulate user POST confirm (never GET-consume)
  const fd = new FormData();
  fd.set("token", token);
  await confirmMagicLinkAction(fd);
}
