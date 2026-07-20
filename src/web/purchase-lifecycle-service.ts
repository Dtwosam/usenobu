/**
 * Purchase lifecycle service — list by tab, outcome, archive, restore, delete.
 * Account-owned history is durable (Postgres blobs). Guests use local web DB only.
 */
import type { NobuDatabase } from "../db/index.js";
import { getWebDatabase } from "./db.js";
import { getAuthStore, isAccountOwnerRef } from "../auth/auth-store.js";
import {
  exportPurchaseBlob,
  importPurchaseBlobs,
} from "../auth/purchase-blobs.js";
import { consumerOwnsPurchase, normalizeOwnerRef } from "./session-owner.js";
import {
  isUserOutcome,
  mapPurchaseLifecycle,
  partitionByLifecycle,
  type LifecycleTab,
  type PurchaseListItem,
  type UserOutcome,
  USER_OUTCOME_DISCLOSURE,
  USER_OUTCOME_LABELS,
} from "./purchase-lifecycle.js";

export { USER_OUTCOME_DISCLOSURE, USER_OUTCOME_LABELS };

function enrichFromLocal(
  db: NobuDatabase,
  row: Record<string, unknown>,
  meta: {
    archived_at: string | null;
    user_outcome: string | null;
    user_outcome_at: string | null;
  },
): PurchaseListItem {
  const id = String(row.id);
  const purchasePrice = Number(row.purchase_price);
  const status = String(row.status ?? "");

  let product_title: string | null = null;
  try {
    const fp = row.fingerprint_id
      ? (db
          .prepare(
            `SELECT product_title FROM product_fingerprints WHERE fingerprint_id = ?`,
          )
          .get(String(row.fingerprint_id)) as
          | { product_title: string | null }
          | undefined)
      : undefined;
    product_title = fp?.product_title ?? null;
  } catch {
    product_title = null;
  }
  if (!product_title) {
    try {
      const match = db
        .prepare(
          `SELECT product_title FROM product_matches WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(id) as { product_title?: string } | undefined;
      product_title = match?.product_title ?? null;
    } catch {
      /* ignore */
    }
  }

  let latest_observed_price: number | null = null;
  try {
    const obs = db
      .prepare(
        `SELECT observed_price FROM price_observations
         WHERE purchase_id = ? AND observed_price IS NOT NULL
         ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(id) as { observed_price: number } | undefined;
    if (obs?.observed_price != null) {
      latest_observed_price = Number(obs.observed_price);
    }
  } catch {
    /* ignore */
  }

  let has_price_drop_alert = false;
  let alertRecovery: number | null = null;
  try {
    const alert = db
      .prepare(
        `SELECT potential_recovery FROM alerts WHERE purchase_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id) as { potential_recovery: number } | undefined;
    if (alert) {
      has_price_drop_alert = true;
      alertRecovery = Number(alert.potential_recovery);
    }
  } catch {
    /* ignore */
  }

  let possible_difference: number | null = null;
  if (
    latest_observed_price != null &&
    Number.isFinite(purchasePrice) &&
    latest_observed_price < purchasePrice
  ) {
    possible_difference =
      Math.round((purchasePrice - latest_observed_price) * 100) / 100;
  } else if (alertRecovery != null && Number.isFinite(alertRecovery)) {
    possible_difference = alertRecovery;
  }

  const archived_at = meta.archived_at;
  const user_outcome =
    meta.user_outcome && isUserOutcome(meta.user_outcome)
      ? meta.user_outcome
      : null;

  const lifecycle = mapPurchaseLifecycle({
    status,
    archived_at,
    monitoring_deadline: row.monitoring_deadline
      ? String(row.monitoring_deadline)
      : null,
    has_price_drop_alert,
  });

  return {
    id,
    target_product_url: String(row.target_product_url ?? ""),
    purchase_price: row.purchase_price as number | string,
    currency: String(row.currency ?? "USD"),
    purchase_date: String(row.purchase_date ?? ""),
    status,
    fingerprint_id: row.fingerprint_id ? String(row.fingerprint_id) : null,
    monitoring_deadline: row.monitoring_deadline
      ? String(row.monitoring_deadline)
      : null,
    updated_at: String(row.updated_at ?? ""),
    product_title,
    latest_observed_price,
    possible_difference,
    has_price_drop_alert,
    archived_at,
    user_outcome,
    user_outcome_at: meta.user_outcome_at,
    lifecycle,
  };
}

/**
 * List owner-scoped purchases with lifecycle metadata.
 * Signed-in accounts hydrate durable blobs first.
 */
export async function listPurchasesForLifecycle(args: {
  owner_ref: string;
  kind: "account" | "guest";
  db?: NobuDatabase;
}): Promise<{
  items: PurchaseListItem[];
  by_tab: Record<LifecycleTab, PurchaseListItem[]>;
  counts: Record<LifecycleTab, number>;
}> {
  const db = args.db ?? getWebDatabase();
  const owner = normalizeOwnerRef(args.owner_ref);
  if (!owner) {
    const empty = { active: [], history: [], archived: [] };
    return {
      items: [],
      by_tab: empty,
      counts: { active: 0, history: 0, archived: 0 },
    };
  }

  // Guest: local only (no durable archive meta)
  if (args.kind === "guest" || !isAccountOwnerRef(owner)) {
    const rows = db
      .prepare(
        `SELECT * FROM purchases WHERE user_ref = ? ORDER BY updated_at DESC LIMIT 100`,
      )
      .all(owner) as Array<Record<string, unknown>>;
    const items = rows.map((r) =>
      enrichFromLocal(db, r, {
        archived_at: null,
        user_outcome: null,
        user_outcome_at: null,
      }),
    );
    const by_tab = partitionByLifecycle(items);
    return {
      items,
      by_tab,
      counts: {
        active: by_tab.active.length,
        history: by_tab.history.length,
        archived: by_tab.archived.length,
      },
    };
  }

  // Account: durable blobs are source of truth for history across devices
  const store = await getAuthStore({ sqliteDb: db });
  const blobs = await store.listPurchaseBlobs(owner);
  importPurchaseBlobs(db, blobs);

  const metaById = new Map(
    blobs.map((b) => [
      b.purchase_id,
      {
        archived_at: b.archived_at ?? null,
        user_outcome: b.user_outcome ?? null,
        user_outcome_at: b.user_outcome_at ?? null,
      },
    ]),
  );

  const rows = db
    .prepare(
      `SELECT * FROM purchases WHERE user_ref = ? ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(owner) as Array<Record<string, unknown>>;

  // Include any local account rows not yet blobbed
  const items = rows.map((r) => {
    const id = String(r.id);
    const meta = metaById.get(id) ?? {
      archived_at: null,
      user_outcome: null,
      user_outcome_at: null,
    };
    return enrichFromLocal(db, r, meta);
  });

  // Also surface durable-only rows that failed local import
  for (const b of blobs) {
    if (items.some((i) => i.id === b.purchase_id)) continue;
    try {
      const payload = JSON.parse(b.blob_json) as {
        purchase?: Record<string, unknown>;
      };
      if (payload.purchase) {
        items.push(
          enrichFromLocal(db, payload.purchase, {
            archived_at: b.archived_at ?? null,
            user_outcome: b.user_outcome ?? null,
            user_outcome_at: b.user_outcome_at ?? null,
          }),
        );
      }
    } catch {
      /* skip */
    }
  }

  const by_tab = partitionByLifecycle(items);
  return {
    items,
    by_tab,
    counts: {
      active: by_tab.active.length,
      history: by_tab.history.length,
      archived: by_tab.archived.length,
    },
  };
}

async function assertAccountOwns(
  db: NobuDatabase,
  accountId: string,
  purchaseId: string,
): Promise<Record<string, unknown> | null> {
  if (!isAccountOwnerRef(accountId)) return null;
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE id = ?`)
    .get(purchaseId) as Record<string, unknown> | undefined;
  if (
    purchase &&
    consumerOwnsPurchase(
      purchase.user_ref as string | null | undefined,
      accountId,
    )
  ) {
    return purchase;
  }
  // Durable-only ownership
  const store = await getAuthStore({ sqliteDb: db });
  const blob = await store.getPurchaseBlob(accountId, purchaseId);
  if (!blob) return null;
  try {
    importPurchaseBlobs(db, [blob]);
    return (
      (db.prepare(`SELECT * FROM purchases WHERE id = ?`).get(purchaseId) as
        | Record<string, unknown>
        | undefined) ?? null
    );
  } catch {
    return null;
  }
}

export async function archivePurchase(args: {
  accountId: string;
  purchaseId: string;
  db?: NobuDatabase;
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "unauthorized" }> {
  const db = args.db ?? getWebDatabase();
  if (!isAccountOwnerRef(args.accountId)) {
    return { ok: false, error: "unauthorized" };
  }
  const purchase = await assertAccountOwns(db, args.accountId, args.purchaseId);
  if (!purchase) return { ok: false, error: "not_found" };

  const store = await getAuthStore({ sqliteDb: db });
  const nowIso = new Date().toISOString();
  // Ensure blob exists
  const blobJson = exportPurchaseBlob(db, args.purchaseId);
  if (blobJson) {
    await store.savePurchaseBlob({
      accountId: args.accountId,
      purchaseId: args.purchaseId,
      blobJson,
      nowIso,
    });
  }
  const ok = await store.updatePurchaseLifecycleMeta({
    accountId: args.accountId,
    purchaseId: args.purchaseId,
    archived_at: nowIso,
    nowIso,
  });
  if (!ok) return { ok: false, error: "not_found" };
  return { ok: true };
}

export async function restorePurchase(args: {
  accountId: string;
  purchaseId: string;
  db?: NobuDatabase;
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "unauthorized" }> {
  const db = args.db ?? getWebDatabase();
  if (!isAccountOwnerRef(args.accountId)) {
    return { ok: false, error: "unauthorized" };
  }
  const purchase = await assertAccountOwns(db, args.accountId, args.purchaseId);
  if (!purchase) return { ok: false, error: "not_found" };

  const store = await getAuthStore({ sqliteDb: db });
  const nowIso = new Date().toISOString();
  const blobJson = exportPurchaseBlob(db, args.purchaseId);
  if (blobJson) {
    await store.savePurchaseBlob({
      accountId: args.accountId,
      purchaseId: args.purchaseId,
      blobJson,
      nowIso,
    });
  }
  const ok = await store.updatePurchaseLifecycleMeta({
    accountId: args.accountId,
    purchaseId: args.purchaseId,
    archived_at: null,
    nowIso,
  });
  if (!ok) return { ok: false, error: "not_found" };
  return { ok: true };
}

export async function setPurchaseOutcome(args: {
  accountId: string;
  purchaseId: string;
  outcome: UserOutcome;
  db?: NobuDatabase;
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "unauthorized" | "invalid_outcome" }> {
  const db = args.db ?? getWebDatabase();
  if (!isAccountOwnerRef(args.accountId)) {
    return { ok: false, error: "unauthorized" };
  }
  if (!isUserOutcome(args.outcome)) {
    return { ok: false, error: "invalid_outcome" };
  }
  const purchase = await assertAccountOwns(db, args.accountId, args.purchaseId);
  if (!purchase) return { ok: false, error: "not_found" };

  const store = await getAuthStore({ sqliteDb: db });
  const nowIso = new Date().toISOString();
  const blobJson = exportPurchaseBlob(db, args.purchaseId);
  if (blobJson) {
    await store.savePurchaseBlob({
      accountId: args.accountId,
      purchaseId: args.purchaseId,
      blobJson,
      nowIso,
    });
  }
  // Does not alter purchase.status, observations, alerts, or matching.
  const ok = await store.updatePurchaseLifecycleMeta({
    accountId: args.accountId,
    purchaseId: args.purchaseId,
    user_outcome: args.outcome,
    user_outcome_at: nowIso,
    nowIso,
  });
  if (!ok) return { ok: false, error: "not_found" };
  return { ok: true };
}

export async function deletePurchasePermanently(args: {
  accountId: string;
  purchaseId: string;
  db?: NobuDatabase;
}): Promise<{ ok: true } | { ok: false; error: "not_found" | "unauthorized" }> {
  const db = args.db ?? getWebDatabase();
  if (!isAccountOwnerRef(args.accountId)) {
    return { ok: false, error: "unauthorized" };
  }
  const purchase = await assertAccountOwns(db, args.accountId, args.purchaseId);
  if (!purchase) return { ok: false, error: "not_found" };

  const store = await getAuthStore({ sqliteDb: db });
  await store.deletePurchaseBlob({
    accountId: args.accountId,
    purchaseId: args.purchaseId,
  });

  // Local cascade (fail closed to owner only)
  const id = args.purchaseId;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM alerts WHERE purchase_id = ?`).run(id);
    db.prepare(`DELETE FROM monitor_runs WHERE purchase_id = ?`).run(id);
    db.prepare(`DELETE FROM price_observations WHERE purchase_id = ?`).run(id);
    try {
      db.prepare(`DELETE FROM enrollment_discovery WHERE purchase_id = ?`).run(
        id,
      );
    } catch {
      /* optional table */
    }
    db.prepare(`DELETE FROM product_fingerprints WHERE purchase_id = ?`).run(
      id,
    );
    db.prepare(`DELETE FROM product_matches WHERE purchase_id = ?`).run(id);
    db.prepare(
      `DELETE FROM purchases WHERE id = ? AND user_ref = ?`,
    ).run(id, args.accountId);
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { ok: true };
}
