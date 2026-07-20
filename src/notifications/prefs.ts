/**
 * Purchase-level email-alert consent.
 * Off until explicitly enabled. Durable via account blob meta + local prefs table.
 */
import type { NobuDatabase } from "../db/migrator.js";
import { getAuthStore, isAccountOwnerRef } from "../auth/auth-store.js";
import { exportPurchaseBlob } from "../auth/purchase-blobs.js";
import { consumerOwnsPurchase } from "../web/session-owner.js";
import type { PurchaseEmailAlertPref } from "./types.js";

export function getEmailAlertPref(
  db: NobuDatabase,
  purchaseId: string,
): PurchaseEmailAlertPref | null {
  try {
    const row = db
      .prepare(`SELECT * FROM purchase_email_alert_prefs WHERE purchase_id = ?`)
      .get(purchaseId) as
      | {
          purchase_id: string;
          account_id: string;
          enabled: number;
          consent_at: string | null;
          disabled_at: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      purchase_id: row.purchase_id,
      account_id: row.account_id,
      enabled: row.enabled === 1,
      consent_at: row.consent_at,
      disabled_at: row.disabled_at,
      updated_at: row.updated_at,
    };
  } catch {
    return null;
  }
}

export function isEmailAlertsEnabled(
  db: NobuDatabase,
  purchaseId: string,
): boolean {
  const pref = getEmailAlertPref(db, purchaseId);
  return Boolean(pref?.enabled);
}

function upsertLocalPref(args: {
  db: NobuDatabase;
  purchaseId: string;
  accountId: string;
  enabled: boolean;
  nowIso: string;
}): void {
  const existing = getEmailAlertPref(args.db, args.purchaseId);
  const consent_at = args.enabled
    ? (existing?.consent_at ?? args.nowIso)
    : (existing?.consent_at ?? null);
  const disabled_at = args.enabled ? null : args.nowIso;

  args.db
    .prepare(
      `INSERT INTO purchase_email_alert_prefs
       (purchase_id, account_id, enabled, consent_at, disabled_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(purchase_id) DO UPDATE SET
         account_id = excluded.account_id,
         enabled = excluded.enabled,
         consent_at = excluded.consent_at,
         disabled_at = excluded.disabled_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      args.purchaseId,
      args.accountId,
      args.enabled ? 1 : 0,
      consent_at,
      disabled_at,
      args.nowIso,
    );
}

export type SetEmailAlertPrefResult =
  | { ok: true; pref: PurchaseEmailAlertPref }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "not_found"
        | "not_account"
        | "guest_must_sign_in"
        | "server_error";
    };

/**
 * Owner-scoped consent toggle. Guests cannot enable.
 * Account A cannot change account B's purchase preference.
 */
export async function setEmailAlertPreference(args: {
  db: NobuDatabase;
  accountId: string;
  purchaseId: string;
  enabled: boolean;
  nowIso?: string;
}): Promise<SetEmailAlertPrefResult> {
  if (!isAccountOwnerRef(args.accountId)) {
    return { ok: false, error: "guest_must_sign_in" };
  }

  const purchase = args.db
    .prepare(`SELECT id, user_ref FROM purchases WHERE id = ?`)
    .get(args.purchaseId) as
    | { id: string; user_ref: string | null }
    | undefined;

  if (
    !purchase ||
    !consumerOwnsPurchase(purchase.user_ref, args.accountId)
  ) {
    // Durable-only ownership check
    try {
      const store = await getAuthStore({ sqliteDb: args.db });
      const blob = await store.getPurchaseBlob(
        args.accountId,
        args.purchaseId,
      );
      if (!blob) return { ok: false, error: "not_found" };
    } catch {
      return { ok: false, error: "not_found" };
    }
  }

  const nowIso = args.nowIso ?? new Date().toISOString();

  try {
    upsertLocalPref({
      db: args.db,
      purchaseId: args.purchaseId,
      accountId: args.accountId,
      enabled: args.enabled,
      nowIso,
    });

    // Durable meta on account purchase blob
    const store = await getAuthStore({ sqliteDb: args.db });
    const blobJson = exportPurchaseBlob(args.db, args.purchaseId);
    if (blobJson) {
      await store.savePurchaseBlob({
        accountId: args.accountId,
        purchaseId: args.purchaseId,
        blobJson,
        nowIso,
      });
    }
    await store.updatePurchaseLifecycleMeta({
      accountId: args.accountId,
      purchaseId: args.purchaseId,
      email_alerts_enabled: args.enabled ? 1 : 0,
      email_alerts_consent_at: args.enabled
        ? (getEmailAlertPref(args.db, args.purchaseId)?.consent_at ?? nowIso)
        : undefined,
      email_alerts_disabled_at: args.enabled ? null : nowIso,
      nowIso,
    });

    const pref = getEmailAlertPref(args.db, args.purchaseId);
    if (!pref) return { ok: false, error: "server_error" };
    return { ok: true, pref };
  } catch {
    return { ok: false, error: "server_error" };
  }
}

/** Hydrate local prefs from durable blob meta after import. */
export function applyDurableEmailAlertMeta(
  db: NobuDatabase,
  args: {
    purchaseId: string;
    accountId: string;
    email_alerts_enabled?: number | boolean | null;
    email_alerts_consent_at?: string | null;
    email_alerts_disabled_at?: string | null;
    updated_at?: string;
  },
): void {
  if (args.email_alerts_enabled == null && !args.email_alerts_consent_at) {
    return;
  }
  const enabled =
    args.email_alerts_enabled === true ||
    args.email_alerts_enabled === 1;
  const nowIso = args.updated_at ?? new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO purchase_email_alert_prefs
       (purchase_id, account_id, enabled, consent_at, disabled_at, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(purchase_id) DO UPDATE SET
         account_id = excluded.account_id,
         enabled = excluded.enabled,
         consent_at = COALESCE(excluded.consent_at, purchase_email_alert_prefs.consent_at),
         disabled_at = excluded.disabled_at,
         updated_at = excluded.updated_at`,
    ).run(
      args.purchaseId,
      args.accountId,
      enabled ? 1 : 0,
      args.email_alerts_consent_at ?? null,
      args.email_alerts_disabled_at ?? null,
      nowIso,
    );
  } catch {
    /* table may not exist yet in older test DBs */
  }
}
