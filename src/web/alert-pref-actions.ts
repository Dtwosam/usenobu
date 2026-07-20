"use server";

import { revalidatePath } from "next/cache";
import { getWebDatabase, markCookieHydrated } from "./db.js";
import {
  hydrateDatabaseFromCookie,
  persistDatabaseToCookie,
} from "./session-snapshot.js";
import { getEffectivePurchaseOwner } from "../auth/service.js";
import { isAccountOwnerRef } from "../auth/auth-store.js";
import { setEmailAlertPreference } from "../notifications/prefs.js";

async function prepareDb() {
  const db = getWebDatabase();
  markCookieHydrated(false);
  await hydrateDatabaseFromCookie(db);
  return db;
}

export type SetAlertPrefActionResult =
  | {
      ok: true;
      enabled: boolean;
      consent_at: string | null;
    }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "not_found"
        | "guest_must_sign_in"
        | "server_error";
    };

/**
 * Purchase-level email alert consent toggle.
 * Uses verified account email only — no secondary email field.
 */
export async function setEmailAlertPrefAction(args: {
  purchaseId: string;
  enabled: boolean;
}): Promise<SetAlertPrefActionResult> {
  try {
    const db = await prepareDb();
    const effective = await getEffectivePurchaseOwner({
      db,
      createGuestIfMissing: true,
    });
    if (
      effective.kind !== "account" ||
      !isAccountOwnerRef(effective.owner_ref)
    ) {
      return { ok: false, error: "guest_must_sign_in" };
    }

    const result = await setEmailAlertPreference({
      db,
      accountId: effective.owner_ref,
      purchaseId: args.purchaseId,
      enabled: args.enabled,
    });

    if (!result.ok) {
      return {
        ok: false,
        error:
          result.error === "not_found"
            ? "not_found"
            : result.error === "guest_must_sign_in"
              ? "guest_must_sign_in"
              : result.error === "unauthorized"
                ? "unauthorized"
                : "server_error",
      };
    }

    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
    revalidatePath(`/purchases/${args.purchaseId}`);
    revalidatePath("/dashboard");

    return {
      ok: true,
      enabled: result.pref.enabled,
      consent_at: result.pref.consent_at,
    };
  } catch {
    return { ok: false, error: "server_error" };
  }
}
