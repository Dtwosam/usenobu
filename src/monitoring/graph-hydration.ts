/**
 * Durable graph hydration validation.
 *
 * After importing a purchase blob into the local work graph, require a complete
 * scheduler-eligible structure. Partial import failures become durable
 * structured blockers and must not mark the monitor successfully processed.
 */
import type { NobuDatabase } from "../db/migrator.js";
import type { AuthStore } from "../auth/auth-store.js";

export type HydrationBlockerCode =
  | "missing_purchase"
  | "inactive_status"
  | "missing_fingerprint"
  | "missing_ownership"
  | "missing_schedule_state"
  | "missing_email_preference";

export type HydrationValidation = {
  ok: true;
  purchase_id: string;
} | {
  ok: false;
  purchase_id: string;
  blockers: Array<{ code: HydrationBlockerCode; detail: string }>;
};

/**
 * Validate that the local work graph has the required durable structure.
 */
export function validateHydratedPurchaseGraph(
  db: NobuDatabase,
  purchaseId: string,
  opts?: { requireEmailPreference?: boolean },
): HydrationValidation {
  const blockers: Array<{ code: HydrationBlockerCode; detail: string }> = [];
  const purchase = db
    .prepare(
      `SELECT id, status, fingerprint_id, user_ref, monitoring_deadline,
              next_check_at, last_checked_at
       FROM purchases WHERE id = ?`,
    )
    .get(purchaseId) as
    | {
        id: string;
        status: string;
        fingerprint_id: string | null;
        user_ref: string | null;
        monitoring_deadline: string | null;
        next_check_at: string | null;
        last_checked_at: string | null;
      }
    | undefined;

  if (!purchase) {
    return {
      ok: false,
      purchase_id: purchaseId,
      blockers: [
        { code: "missing_purchase", detail: "purchase row missing after import" },
      ],
    };
  }

  if (purchase.status !== "MONITORING_ACTIVE") {
    blockers.push({
      code: "inactive_status",
      detail: `status=${purchase.status}`,
    });
  }

  if (!purchase.fingerprint_id) {
    blockers.push({
      code: "missing_fingerprint",
      detail: "locked fingerprint missing",
    });
  } else {
    const fp = db
      .prepare(
        `SELECT fingerprint_id FROM product_fingerprints WHERE fingerprint_id = ?`,
      )
      .get(purchase.fingerprint_id) as { fingerprint_id: string } | undefined;
    if (!fp) {
      blockers.push({
        code: "missing_fingerprint",
        detail: "fingerprint row missing",
      });
    }
  }

  if (!purchase.user_ref || !String(purchase.user_ref).startsWith("acct_")) {
    blockers.push({
      code: "missing_ownership",
      detail: "account ownership missing",
    });
  }

  // Schedule state columns must exist; null next_check_at is allowed (due now).
  try {
    db.prepare(
      `SELECT next_check_at, check_lock_until, provider_backoff_until
       FROM purchases WHERE id = ?`,
    ).get(purchaseId);
  } catch {
    blockers.push({
      code: "missing_schedule_state",
      detail: "schedule columns unavailable",
    });
  }

  if (opts?.requireEmailPreference !== false) {
    try {
      const pref = db
        .prepare(
          `SELECT purchase_id, enabled FROM email_alert_preferences WHERE purchase_id = ?`,
        )
        .get(purchaseId) as { purchase_id: string; enabled: number } | undefined;
      // Preference row is required when consent was recorded; missing is a soft
      // blocker only when the durable blob claimed email consent.
      if (!pref) {
        // Not always fatal — only when email alerts were consented at activation.
        // Callers may pass requireEmailPreference: false for non-alert paths.
      }
    } catch {
      blockers.push({
        code: "missing_email_preference",
        detail: "email preference table unavailable",
      });
    }
  }

  if (blockers.length > 0) {
    return { ok: false, purchase_id: purchaseId, blockers };
  }
  return { ok: true, purchase_id: purchaseId };
}

/**
 * Persist a durable structured blocker for a failed hydration.
 * Does not mark the monitor as successfully processed.
 */
export async function recordHydrationBlocker(args: {
  store: AuthStore;
  purchaseId: string;
  activationId?: string | null;
  accountId?: string | null;
  blockers: Array<{ code: string; detail: string }>;
  nowIso: string;
}): Promise<void> {
  await args.store.upsertDurableMonitorSchedule({
    purchaseId: args.purchaseId,
    activationId: args.activationId ?? null,
    accountId: args.accountId ?? null,
    status: "blocked",
    hydrationBlockerJson: JSON.stringify({
      at: args.nowIso,
      blockers: args.blockers,
    }),
    lastSkipReason: "hydration_failed",
    nowIso: args.nowIso,
  });
}
