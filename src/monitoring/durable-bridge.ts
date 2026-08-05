/**
 * Durable-to-scheduler bridge.
 *
 * durable_monitor_schedule is the authoritative work source.
 * Local SQLite is an execution cache only.
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
import {
  isEmailAlertsEnabled,
  getEmailAlertPref,
} from "../notifications/prefs.js";
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
import { processDueNotificationOutbox } from "../notifications/outbox-retry.js";

export const DEFAULT_DURABLE_HYDRATE_LIMIT = 50;
export const GLOBAL_SCHEDULER_LEASE_KEY = "nobu_monitor_scheduler";
/** Lease TTL must exceed max tick wall time; renew if needed. */
export const GLOBAL_SCHEDULER_LEASE_TTL_MS = 10 * 60 * 1000;

export type DurableBridgeResult = ScheduledMonitorResult & {
  durable_hydrated: number;
  durable_skipped_ineligible: number;
  durable_persisted: number;
  durable_hydration_blocked: number;
  activation_reconciled: number;
  settlement_reconciled: number;
  outbox_retried: number;
  lease_acquired: boolean;
  pages_processed: number;
  provider_fetch_ids: string[];
};

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Hydrate from durable_monitor_schedule (source of truth), not raw activations.
 * Keyset: ORDER BY purchase_id ASC, purchase_id > cursor.
 * Only active + due schedules; blocked/stopped/expired never occupy the page.
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
  more: boolean;
}> {
  const store =
    args.store ??
    (await getAuthStore({
      sqliteDb: args.db,
      env: args.env,
    }));
  const limit = args.limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT;
  const nowIso = args.nowIso ?? new Date().toISOString();

  // Authoritative due page from durable schedule.
  const dueRows = await store.listDueDurableMonitorSchedules({
    asOfIso: nowIso,
    limit: limit + 1,
    afterPurchaseId: args.afterPurchaseId ?? null,
  });
  const page = dueRows.slice(0, limit);
  const more = dueRows.length > limit;

  const blobs: PurchaseBlobRow[] = [];
  let skipped_ineligible = 0;
  let hydration_blocked = 0;
  const validIds: string[] = [];
  let lastSeen: string | null = null;

  for (const row of page) {
    lastSeen = row.purchase_id;
    const blob = await store.getPurchaseBlobByPurchaseId(row.purchase_id);
    if (!blob || !purchaseBlobIsSchedulerEligible(blob)) {
      skipped_ineligible += 1;
      await store.upsertDurableMonitorSchedule({
        purchaseId: row.purchase_id,
        activationId: row.activation_id,
        accountId: row.account_id,
        status: "stopped",
        lastSkipReason: "ineligible_or_missing_blob",
        nowIso,
      });
      continue;
    }

    const activation = await store.getActiveMonitorActivationByPurchaseId(
      row.purchase_id,
    );
    if (!activation) {
      skipped_ineligible += 1;
      await store.upsertDurableMonitorSchedule({
        purchaseId: row.purchase_id,
        status: "stopped",
        lastSkipReason: "activation_not_active",
        nowIso,
      });
      continue;
    }

    blobs.push(blob);
  }

  importPurchaseBlobs(args.db, blobs);

  for (const blob of blobs) {
    const validation = validateHydratedPurchaseGraph(
      args.db,
      blob.purchase_id,
    );
    if (!validation.ok) {
      hydration_blocked += 1;
      await recordHydrationBlocker({
        store,
        purchaseId: blob.purchase_id,
        blockers: validation.blockers,
        nowIso,
      });
      continue;
    }
    validIds.push(blob.purchase_id);
  }

  return {
    hydrated: validIds.length,
    skipped_ineligible,
    hydration_blocked,
    purchase_ids: validIds,
    last_purchase_id: lastSeen,
    store,
    more,
  };
}

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
 * Ensure durable schedule rows exist for active activations (bootstrap).
 * Called once per tick before due-page selection.
 */
export async function bootstrapDurableSchedulesFromActivations(args: {
  store: AuthStore;
  nowIso: string;
  limit?: number;
}): Promise<number> {
  let n = 0;
  let cursor: string | null = null;
  const pageSize = 50;
  const maxPages = 20;
  for (let p = 0; p < maxPages; p++) {
    const batch = await args.store.listActiveMonitorActivations({
      limit: pageSize,
      afterPurchaseId: cursor,
    });
    if (!batch.length) break;
    for (const act of batch) {
      await args.store.upsertDurableMonitorSchedule({
        purchaseId: act.purchase_id,
        activationId: act.id,
        status: "active",
        nextCheckAt: null,
        nowIso: args.nowIso,
      });
      n += 1;
    }
    cursor = batch[batch.length - 1]!.purchase_id;
    if (batch.length < pageSize) break;
  }
  return n;
}

export async function runScheduledMonitoringTickWithDurableBridge(
  options: ScheduledMonitorOptions & {
    env?: EnvRecord;
    durable_hydrate_limit?: number;
    store?: AuthStore;
    use_durable_bridge?: boolean;
    max_pages?: number;
    lease_holder_id?: string;
    durable_monthly_search_limit?: number;
  },
): Promise<DurableBridgeResult> {
  const useBridge = options.use_durable_bridge !== false;
  const asOf = options.as_of ?? new Date().toISOString();
  const pageLimit =
    options.durable_hydrate_limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT;
  const maxPages = options.max_pages ?? 4;
  const holderId =
    options.lease_holder_id ?? `worker_${randomUUID().slice(0, 12)}`;

  let durable_hydrated = 0;
  let durable_skipped_ineligible = 0;
  let durable_persisted = 0;
  let durable_hydration_blocked = 0;
  let activation_reconciled = 0;
  let settlement_reconciled = 0;
  let outbox_retried = 0;
  let pages_processed = 0;
  let hydratedIds: string[] = [];
  let store: AuthStore | null = null;
  let lease_acquired = false;
  const provider_fetch_ids: string[] = [];

  try {
    if (useBridge) {
      store =
        options.store ??
        (await getAuthStore({
          sqliteDb: options.db,
          env: options.env,
        }));

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

      // Bootstrap schedule rows for active activations (idempotent).
      try {
        await bootstrapDurableSchedulesFromActivations({
          store,
          nowIso: asOf,
        });
      } catch {
        /* non-fatal */
      }

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
        return emptyResult(asOf, {
          activation_reconciled,
          settlement_reconciled,
        });
      }

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
        if (!hydrated.last_purchase_id) break;
        after = hydrated.last_purchase_id;
        if (!hydrated.more) break;
      }
    }

    // Provider fetch ids are recorded from tick results (checked/error), not from
    // fetcher argument shape (which carries purchase + fingerprint, not purchase_id).
    const result = await runScheduledMonitoringTick({
      ...options,
      fetchObservation: options.fetchObservation,
      accountStore: store ?? options.store,
      env: options.env,
      durableAuthStore: store ?? undefined,
      durableBudgetPeriodKey: asOf.slice(0, 7),
      durableMonthlySearchLimit:
        options.durable_monthly_search_limit ??
        options.monthly_search_limit ??
        500,
    });

    for (const r of result.results) {
      if (r.outcome === "checked" || r.outcome === "error") {
        provider_fetch_ids.push(r.purchase_id);
      }
    }

    if (useBridge && store) {
      try {
        const outbox = await processDueNotificationOutbox({
          store,
          nowIso: asOf,
          env: options.env,
          limit: 20,
          db: options.db,
        });
        outbox_retried = outbox.processed;
      } catch {
        /* non-fatal */
      }

      const processed = result.results.map((r) => r.purchase_id);
      const toPersist = Array.from(new Set([...hydratedIds, ...processed]));
      durable_persisted = await persistAccountPurchasesToDurable({
        db: options.db,
        store,
        purchaseIds: toPersist,
        nowIso: asOf,
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
      outbox_retried,
      lease_acquired,
      pages_processed,
      provider_fetch_ids: Array.from(new Set(provider_fetch_ids)),
    };
  } finally {
    if (useBridge && store && lease_acquired) {
      try {
        await store.releaseGlobalLease({
          leaseKey: GLOBAL_SCHEDULER_LEASE_KEY,
          holderId,
        });
      } catch {
        /* ignore */
      }
    }
  }
}

function emptyResult(
  asOf: string,
  extra: { activation_reconciled: number; settlement_reconciled: number },
): DurableBridgeResult {
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
    activation_reconciled: extra.activation_reconciled,
    settlement_reconciled: extra.settlement_reconciled,
    outbox_retried: 0,
    lease_acquired: false,
    pages_processed: 0,
    provider_fetch_ids: [],
  };
}

export function debugEmailConsentEnabled(
  db: NobuDatabase,
  purchaseId: string,
): boolean {
  return isEmailAlertsEnabled(db, purchaseId);
}
