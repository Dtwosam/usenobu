/**
 * Lane 7.4F — durable-to-scheduler bridge.
 *
 * Production scheduler storage is per-instance `/tmp` SQLite; agent monitors
 * and account blobs live in the durable AuthStore. This bridge:
 * 1) loads active agent monitor blobs from durable storage;
 * 2) hydrates them into the scheduler local DB (with email-alert prefs);
 * 3) runs the existing runScheduledMonitoringTick;
 * 4) persists processed account-owned graphs back to durable storage.
 *
 * No parallel scheduler, notification system, or monitor entity.
 */
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

/** Max agent activations/blobs loaded per tick (before local batch/budget). */
export const DEFAULT_DURABLE_HYDRATE_LIMIT = 50;

export type DurableBridgeResult = ScheduledMonitorResult & {
  durable_hydrated: number;
  durable_skipped_ineligible: number;
  durable_persisted: number;
};

type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

/**
 * Load active agent-originated monitors from durable AuthStore into local db.
 * Skips stopped / non-active / missing-fingerprint blobs (not fetched into work).
 */
export async function hydrateActiveAgentMonitorsFromDurable(args: {
  db: NobuDatabase;
  store?: AuthStore;
  env?: EnvRecord;
  limit?: number;
}): Promise<{
  hydrated: number;
  skipped_ineligible: number;
  purchase_ids: string[];
  store: AuthStore;
}> {
  const store =
    args.store ??
    (await getAuthStore({
      sqliteDb: args.db,
      env: args.env,
    }));
  const limit = args.limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT;
  const activations = await store.listActiveMonitorActivations({ limit });

  const blobs: PurchaseBlobRow[] = [];
  let skipped_ineligible = 0;
  for (const act of activations) {
    const blob = await store.getPurchaseBlobByPurchaseId(act.purchase_id);
    if (!blob) {
      skipped_ineligible += 1;
      continue;
    }
    if (!purchaseBlobIsSchedulerEligible(blob)) {
      skipped_ineligible += 1;
      continue;
    }
    blobs.push(blob);
  }

  importPurchaseBlobs(args.db, blobs);
  return {
    hydrated: blobs.length,
    skipped_ineligible,
    purchase_ids: blobs.map((b) => b.purchase_id),
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
    // Keep email meta aligned with local pref after tick side-effects.
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
    n += 1;
  }
  return n;
}

/**
 * Full bridge: hydrate durable agent monitors → existing tick → persist back.
 */
export async function runScheduledMonitoringTickWithDurableBridge(
  options: ScheduledMonitorOptions & {
    env?: EnvRecord;
    durable_hydrate_limit?: number;
    /** Inject durable AuthStore (tests / multi-db). Default: resolve from env/local. */
    store?: AuthStore;
    /** When false, skip durable hydrate/persist (local-only tests). Default true. */
    use_durable_bridge?: boolean;
  },
): Promise<DurableBridgeResult> {
  const useBridge = options.use_durable_bridge !== false;
  const asOf = options.as_of ?? new Date().toISOString();

  let durable_hydrated = 0;
  let durable_skipped_ineligible = 0;
  let durable_persisted = 0;
  let hydratedIds: string[] = [];
  let store: AuthStore | null = null;

  if (useBridge) {
    const hydrated = await hydrateActiveAgentMonitorsFromDurable({
      db: options.db,
      store: options.store,
      env: options.env,
      limit: options.durable_hydrate_limit ?? DEFAULT_DURABLE_HYDRATE_LIMIT,
    });
    durable_hydrated = hydrated.hydrated;
    durable_skipped_ineligible = hydrated.skipped_ineligible;
    hydratedIds = hydrated.purchase_ids;
    store = hydrated.store;
  }

  const result = await runScheduledMonitoringTick({
    ...options,
    // Account email lookup uses durable store when purchases are local-only.
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
  }

  return {
    ...result,
    durable_hydrated,
    durable_skipped_ineligible,
    durable_persisted,
  };
}

/** Test helper — does not log emails. */
export function debugEmailConsentEnabled(
  db: NobuDatabase,
  purchaseId: string,
): boolean {
  return isEmailAlertsEnabled(db, purchaseId);
}
