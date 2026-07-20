"use server";

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getWebDatabase, markCookieHydrated } from "./db.js";
import {
  hydrateDatabaseFromCookie,
  persistDatabaseToCookie,
} from "./session-snapshot.js";
import { getEffectivePurchaseOwner } from "../auth/service.js";
import {
  archivePurchase,
  deletePurchasePermanently,
  restorePurchase,
  setPurchaseOutcome,
} from "./purchase-lifecycle-service.js";
import { isUserOutcome, type UserOutcome } from "./purchase-lifecycle.js";
import { isAccountOwnerRef } from "../auth/auth-store.js";

async function prepareDb() {
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

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

async function requireAccount(db: ReturnType<typeof getWebDatabase>) {
  const effective = await getEffectivePurchaseOwner({
    db,
    createGuestIfMissing: true,
  });
  if (effective.kind !== "account" || !isAccountOwnerRef(effective.owner_ref)) {
    return null;
  }
  return effective.owner_ref;
}

export async function archivePurchaseAction(formData: FormData): Promise<void> {
  const purchaseId = formString(formData, "purchase_id");
  const tab = formString(formData, "tab") || "active";
  try {
    const db = await prepareDb();
    const accountId = await requireAccount(db);
    if (!accountId) redirect(`/dashboard?error=unauthorized`);
    const result = await archivePurchase({
      accountId,
      purchaseId,
      db,
    });
    if (!result.ok) redirect(`/dashboard?tab=${tab}&error=not_found`);
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
    redirect(`/dashboard?tab=archived`);
  } catch (err) {
    rethrowIfNavigation(err);
    redirect(`/dashboard?tab=${tab}&error=server_error`);
  }
}

export async function restorePurchaseAction(formData: FormData): Promise<void> {
  const purchaseId = formString(formData, "purchase_id");
  try {
    const db = await prepareDb();
    const accountId = await requireAccount(db);
    if (!accountId) redirect(`/dashboard?error=unauthorized`);
    const result = await restorePurchase({
      accountId,
      purchaseId,
      db,
    });
    if (!result.ok) redirect(`/dashboard?tab=archived&error=not_found`);
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
    redirect(`/dashboard?tab=active`);
  } catch (err) {
    rethrowIfNavigation(err);
    redirect(`/dashboard?tab=archived&error=server_error`);
  }
}

export async function setOutcomeAction(formData: FormData): Promise<void> {
  const purchaseId = formString(formData, "purchase_id");
  const outcome = formString(formData, "outcome");
  const tab = formString(formData, "tab") || "active";
  try {
    const db = await prepareDb();
    const accountId = await requireAccount(db);
    if (!accountId) redirect(`/dashboard?error=unauthorized`);
    if (!isUserOutcome(outcome)) {
      redirect(`/dashboard?tab=${tab}&error=invalid_outcome`);
    }
    const result = await setPurchaseOutcome({
      accountId,
      purchaseId,
      outcome: outcome as UserOutcome,
      db,
    });
    if (!result.ok) redirect(`/dashboard?tab=${tab}&error=not_found`);
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
    redirect(`/dashboard?tab=${tab}&outcome_saved=1`);
  } catch (err) {
    rethrowIfNavigation(err);
    redirect(`/dashboard?tab=${tab}&error=server_error`);
  }
}

export async function deletePurchaseAction(formData: FormData): Promise<void> {
  const purchaseId = formString(formData, "purchase_id");
  const confirm = formString(formData, "confirm");
  const tab = formString(formData, "tab") || "active";
  try {
    if (confirm !== "delete") {
      redirect(`/dashboard?tab=${tab}&error=delete_not_confirmed`);
    }
    const db = await prepareDb();
    const accountId = await requireAccount(db);
    if (!accountId) redirect(`/dashboard?error=unauthorized`);
    const result = await deletePurchasePermanently({
      accountId,
      purchaseId,
      db,
    });
    if (!result.ok) redirect(`/dashboard?tab=${tab}&error=not_found`);
    await persistDatabaseToCookie(db).catch(() => ({ ok: false as const }));
    redirect(`/dashboard?tab=${tab}&deleted=1`);
  } catch (err) {
    rethrowIfNavigation(err);
    redirect(`/dashboard?tab=${tab}&error=server_error`);
  }
}
