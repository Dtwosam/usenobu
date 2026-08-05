/**
 * Lane 7.4F — durable-to-scheduler bridge.
 *
 * Production scheduler storage is per-instance `/tmp` SQLite; agent monitors
 * and account blobs live in the durable AuthStore. This bridge:
 * 1) reconciles pending_projection activations (no buyer retry required);
 * 2) loads active agent monitor blobs from durable storage (cursor/keyset);
 * 3) validates complete work graph after import;
 * 4) runs the existing runScheduledMonitoringTick under a global lease;
 * 5) persists processed account-owned graphs back to durable storage.
 *
 * Local SQLite remains an execution cache only.
 */
import { randomUUID } from "node:crypto";
import type { NobuDatabase } from "../db/migrator.js";
import {
  getAuthStore,
  isAccountOwnerRef,
  type AuthStore,
  type PurchaseBlobRow,
} from "../auth/auth-store.js";
import {
  exportPurchaseBlob,
  importPurchaseBlobs,
  purchaseBlobIsSchedulerEligible,
} from "../auth/purchase-blobs.js";
import { isEmailAlertsEnabled, getEmailAlertPref } from "../notifications/prefs.js";
import {
  runScheduledMonitoringTick,
  type ScheduledMonitorOptions,
  type ScheduledMonitorResult,
} from "./scheduler.js";
import {
  recordHydrationBlocker,
  validateHydratedPurchaseGraph,
} from "./graph-hydration.js";
import { reconcilePendingActivations } from "../payments/start-monitoring-service.js";
import { reconcilePendingPassSettlements } from "../payments/monitoring-pass-service.js";

/** Max agent activations/blobs loaded per page. */
export const DEFAULT_DURABLE_HYDRATE_LIMIT = 50;
export const GLOBAL_SCHEDULER_LEASE_KEY = "nobu_monitor_scheduler";
export const GLOBAL_SCHEDULER_LEASE_TTL_MS = 4 * 60 * 1000;

export type DurableBridgeResult = ScheduledMonitorResult & {
  durable_hydrated: number;
  durable_skipped_ineligible: number;
  durable_persisted: number;
  durable_hydration_blocked: number;
  activation_reconciled: number;
  settlement_reconciled: number;
  lease_acquired: boolean;
  pages_processed: number;
};

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Load active agent-originated monitors from durable AuthStore into local db.
 * Uses cursor/keyset pagination so later monitors receive fair processing.
 * Validates full work graph after import; blockers are durable.
 */
export async function hydrateActiveAgentMonitorsFromDurable(args: {
  db: NobuDatabase;
  store?: AuthStore;
  env?: EnvRecord;
  limit?: number;
  afterPurchaseId?: string | null;
  nowIso?: string;
}): Promise<{
  hydrated: number;
  skipped_ineligible: number;
  hydration_blocked: number;
  purchase_ids: string[];
  last_purchase_id: string | null;
  store: AuthStore;
}> {
  const store =
    args.store ??
    (await getAuthStore({
      sqliteDb: args.db,
      env: args.env,
    }));
  const limit = args.limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT;
  const nowIso = args.nowIso ?? new Date().toISOString();
  const activations = await store.listActiveMonitorActivations({
    limit,
    afterPurchaseId: args.afterPurchaseId ?? null,
  });

  const blobs: PurchaseBlobRow[] = [];
  let skipped_ineligible = 0;
  let hydration_blocked = 0;
  const eligibleActs: Array<{ purchase_id: string; id: string }> = [];

  for (const act of activations) {
    const blob = await store.getPurchaseBlobByPurchaseId(act.purchase_id);
    if (!blob) {
      skipped_ineligible += 1;
      await store.upsertDurableMonitorSchedule({
        purchaseId: act.purchase_id,
        activationId: act.id,
        status: "blocked",
        lastSkipReason: "missing_blob",
        hydrationBlockerJson: JSON.stringify({
          code: "missing_blob",
          at: nowIso,
        }),
        nowIso,
      });
      continue;
    }
    if (!purchaseBlobIsSchedulerEligible(blob)) {
      skipped_ineligible += 1;
      // Expired/stopped/invalid must not occupy the active work page forever.
      await store.upsertDurableMonitorSchedule({
        purchaseId: act.purchase_id,
        activationId: act.id,
        accountId: blob.account_id,
        status: "stopped",
        lastSkipReason: "ineligible_blob",
        nowIso,
      });
      continue;
    }
    blobs.push(blob);
    eligibleActs.push({ purchase_id: act.purchase_id, id: act.id });
  }

  importPurchaseBlobs(args.db, blobs);

  const validIds: string[] = [];
  for (const act of eligibleActs) {
    const validation = validateHydratedPurchaseGraph(args.db, act.purchase_id);
    if (!validation.ok) {
      hydration_blocked += 1;
      await recordHydrationBlocker({
        store,
        purchaseId: act.purchase_id,
        activationId: act.id,
        blockers: validation.blockers,
        nowIso,
      });
      // Do not include in successfully hydrated work set.
      continue;
    }
    validIds.push(act.purchase_id);
    await store.upsertDurableMonitorSchedule({
      purchaseId: act.purchase_id,
      activationId: act.id,
      status: "active",
      nowIso,
    });
  }

  const last =
    activations.length > 0
      ? activations[activations.length - 1]!.purchase_id
      : null;

  return {
    hydrated: validIds.length,
    skipped_ineligible,
    hydration_blocked,
    purchase_ids: validIds,
    last_purchase_id: last,
    store,
  };
}

/**
 * Persist account-owned purchase graphs (and email prefs) back to durable store.
 */
export async function persistAccountPurchasesToDurable(args: {
  db: NobuDatabase;
  store: AuthStore;
  purchaseIds: string[];
  nowIso: string;
}): Promise<number> {
  let n = 0;
  for (const purchaseId of args.purchaseIds) {
    const row = args.db
      .prepare(`SELECT id, user_ref FROM purchases WHERE id = ?`)
      .get(purchaseId) as { id: string; user_ref: string | null } | undefined;
    if (!row) continue;
    const accountId = String(row.user_ref || "").trim();
    if (!isAccountOwnerRef(accountId)) continue;

    const blobJson = exportPurchaseBlob(args.db, purchaseId);
    if (!blobJson) continue;

    const pref = getEmailAlertPref(args.db, purchaseId);
    await args.store.savePurchaseBlob({
      accountId,
      purchaseId,
      blobJson,
      nowIso: args.nowIso,
    });
    if (pref) {
      await args.store.updatePurchaseLifecycleMeta({
        accountId,
        purchaseId,
        email_alerts_enabled: pref.enabled ? 1 : 0,
        email_alerts_consent_at: pref.consent_at,
        email_alerts_disabled_at: pref.disabled_at,
        nowIso: args.nowIso,
      });
    }
    // Sync due state to durable control plane.
    const sched = args.db
      .prepare(
        `SELECT next_check_at, last_checked_at, provider_backoff_until, last_skip_reason, status
         FROM purchases WHERE id = ?`,
      )
      .get(purchaseId) as
      | {
          next_check_at: string | null;
          last_checked_at: string | null;
          provider_backoff_until: string | null;
          last_skip_reason: string | null;
          status: string;
        }
      | undefined;
    if (sched) {
      await args.store.upsertDurableMonitorSchedule({
        purchaseId,
        accountId,
        status:
          sched.status === "MONITORING_ACTIVE"
            ? "active"
            : sched.status === "WINDOW_EXPIRED"
              ? "expired"
              : "stopped",
        nextCheckAt: sched.next_check_at,
        lastCheckedAt: sched.last_checked_at,
        providerBackoffUntil: sched.provider_backoff_until,
        lastSkipReason: sched.last_skip_reason,
        nowIso: args.nowIso,
      });
    }
    n += 1;
  }
  return n;
}

/**
 * Full bridge: activation reconcile → hydrate pages → tick → persist.
 * Global lease ensures two concurrent workers do not double-process.
 */
export async function runScheduledMonitoringTickWithDurableBridge(
  options: ScheduledMonitorOptions & {
    env?: EnvRecord;
    durable_hydrate_limit?: number;
    store?: AuthStore;
    use_durable_bridge?: boolean;
    /** Max hydrate pages per tick (fairness across large fleets). */
    max_pages?: number;
    lease_holder_id?: string;
  },
): Promise<DurableBridgeResult> {
  const useBridge = options.use_durable_bridge !== false;
  const asOf = options.as_of ?? new Date().toISOString();
  const pageLimit = options.durable_hydrate_limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT;
  const maxPages = options.max_pages ?? 3;
  const holderId = options.lease_holder_id ?? `worker_${randomUUID().slice(0, 12)}`;

  let durable_hydrated = 0;
  let durable_skipped_ineligible = 0;
  let durable_persisted = 0;
  let durable_hydration_blocked = 0;
  let activation_reconciled = 0;
  let settlement_reconciled = 0;
  let pages_processed = 0;
  let hydratedIds: string[] = [];
  let store: AuthStore | null = null;
  let lease_acquired = true;

  if (useBridge) {
    store =
      options.store ??
      (await getAuthStore({
        sqliteDb: options.db,
        env: options.env,
      }));

    // Phase 0a: payment settlement convergence (no signed-header replay).
    try {
      const settle = await reconcilePendingPassSettlements({
        now: new Date(asOf),
        sqliteDb: options.db,
        env: options.env,
        limit: 25,
      });
      settlement_reconciled = settle.issued;
    } catch {
      /* non-fatal */
    }

    // Phase 0b: pending_projection → active without buyer online.
    try {
      const act = await reconcilePendingActivations({
        now: new Date(asOf),
        sqliteDb: options.db,
        env: options.env,
      });
      activation_reconciled = act.activated;
    } catch {
      /* non-fatal */
    }

    // Global lease — one atomic conditional update with expiry.
    const leaseExpires = new Date(
      Date.parse(asOf) + GLOBAL_SCHEDULER_LEASE_TTL_MS,
    ).toISOString();
    lease_acquired = await store.tryAcquireGlobalLease({
      leaseKey: GLOBAL_SCHEDULER_LEASE_KEY,
      holderId,
      expiresAt: leaseExpires,
      nowIso: asOf,
    });
    if (!lease_acquired) {
      return {
        as_of: asOf,
        considered: 0,
        due: 0,
        processed: 0,
        skipped_not_due: 0,
        skipped_budget: 0,
        searches_consumed: 0,
        alerts_created: 0,
        emails_attempted: 0,
        results: [],
        durable_hydrated: 0,
        durable_skipped_ineligible: 0,
        durable_persisted: 0,
        durable_hydration_blocked: 0,
        activation_reconciled,
        settlement_reconciled,
        lease_acquired: false,
        pages_processed: 0,
      };
    }

    // Cursor/keyset pages so monitors beyond the oldest 50 still run.
    let after: string | null = null;
    for (let page = 0; page < maxPages; page += 1) {
      const hydrated = await hydrateActiveAgentMonitorsFromDurable({
        db: options.db,
        store,
        env: options.env,
        limit: pageLimit,
        afterPurchaseId: after,
        nowIso: asOf,
      });
      durable_hydrated += hydrated.hydrated;
      durable_skipped_ineligible += hydrated.skipped_ineligible;
      durable_hydration_blocked += hydrated.hydration_blocked;
      hydratedIds = hydratedIds.concat(hydrated.purchase_ids);
      pages_processed += 1;
      if (!hydrated.last_purchase_id || hydrated.purchase_ids.length === 0) {
        // Still advance cursor on skipped-only pages so we do not starve.
        if (hydrated.last_purchase_id) {
          after = hydrated.last_purchase_id;
          continue;
        }
        break;
      }
      after = hydrated.last_purchase_id;
      // One tick page is enough for local batch; more pages hydrate only.
      if (page === 0) break;
    }
  }

  const result = await runScheduledMonitoringTick({
    ...options,
    accountStore: store ?? options.store,
    env: options.env,
  });

  if (useBridge && store) {
    const processed = result.results.map((r) => r.purchase_id);
    const toPersist = Array.from(new Set([...hydratedIds, ...processed]));
    durable_persisted = await persistAccountPurchasesToDurable({
      db: options.db,
      store,
      purchaseIds: toPersist,
      nowIso: asOf,
    });
    await store.releaseGlobalLease({
      leaseKey: GLOBAL_SCHEDULER_LEASE_KEY,
      holderId,
    });
  }

  return {
    ...result,
    durable_hydrated,
    durable_skipped_ineligible,
    durable_persisted,
    durable_hydration_blocked,
    activation_reconciled,
    settlement_reconciled,
    lease_acquired,
    pages_processed,
  };
}

/** Test helper — does not log emails. */
export function debugEmailConsentEnabled(
  db: NobuDatabase,
  purchaseId: string,
): boolean {
  return isEmailAlertsEnabled(db, purchaseId);
}
