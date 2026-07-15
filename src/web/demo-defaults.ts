/**
 * Known pre-repair demo placeholders that must never contaminate live discovery.
 * Fixture tests still use these values when the fixture gate is open.
 */

const DEMO_TCIN = "87654321";
const DEMO_MODEL = "WDG-100";
const DEMO_URL_RE = /example-widget|\/A-87654321\b/i;
const DEMO_TITLE_RE = /example\s*widget/i;

export const SESSION_SNAPSHOT_VERSION = 2;

export type PurchaseIdentityFields = {
  target_product_url?: string | null;
  target_item_id?: string | null;
  model_number?: string | null;
  product_title?: string | null;
  upc_or_gtin?: string | null;
};

export function isDemoTcin(value: string | null | undefined): boolean {
  return String(value ?? "").trim() === DEMO_TCIN;
}

export function isDemoModel(value: string | null | undefined): boolean {
  return String(value ?? "").trim() === DEMO_MODEL;
}

export function isDemoUrl(value: string | null | undefined): boolean {
  return DEMO_URL_RE.test(String(value ?? ""));
}

export function isDemoTitle(value: string | null | undefined): boolean {
  return DEMO_TITLE_RE.test(String(value ?? ""));
}

/** True when any known demo placeholder is present. */
export function hasAnyDemoDefault(input: PurchaseIdentityFields): boolean {
  return (
    isDemoUrl(input.target_product_url) ||
    isDemoTcin(input.target_item_id) ||
    isDemoModel(input.model_number) ||
    isDemoTitle(input.product_title)
  );
}

/**
 * Strip known demo placeholders field-by-field.
 * Fresh non-demo values are preserved; demo values become empty/undefined.
 */
export function scrubDemoDefaults<T extends PurchaseIdentityFields>(
  input: T,
): T {
  const url = String(input.target_product_url ?? "");
  const tcin = String(input.target_item_id ?? "").trim();
  const model = String(input.model_number ?? "").trim();
  const title = String(input.product_title ?? "");
  return {
    ...input,
    target_product_url: isDemoUrl(url) ? "" : url,
    target_item_id: isDemoTcin(tcin) ? undefined : tcin || undefined,
    model_number: isDemoModel(model) ? undefined : model || undefined,
    product_title: isDemoTitle(title) ? undefined : title || undefined,
  };
}

/**
 * Live enrollment must not search with only demo identity.
 * After scrub, a missing Target URL means the draft was outdated demo state.
 */
export function isUnusableAfterDemoScrub(
  scrubbed: PurchaseIdentityFields,
): boolean {
  const url = String(scrubbed.target_product_url ?? "").trim();
  return !url;
}

/** Row-level check for cookie purchase drafts (unconfirmed). */
export function isUnconfirmedDemoPurchaseRow(
  row: Record<string, unknown>,
): boolean {
  const fingerprintId = row.fingerprint_id;
  if (fingerprintId != null && String(fingerprintId).length > 0) {
    // Confirmed monitoring records are never auto-erased.
    return false;
  }
  return hasAnyDemoDefault({
    target_product_url: row.target_product_url as string | undefined,
    target_item_id: row.target_item_id as string | undefined,
    model_number: row.model_number as string | undefined,
    product_title: row.product_title as string | undefined,
  });
}

/**
 * Migrate a decoded cookie snapshot: drop unconfirmed demo drafts only.
 * Returns migrated snapshot + whether any draft was removed.
 */
export function migrateSnapshotPurchases(snapshot: {
  purchases?: Array<Record<string, unknown>>;
  product_fingerprints?: Array<Record<string, unknown>>;
  product_matches?: Array<Record<string, unknown>>;
  price_observations?: Array<Record<string, unknown>>;
  alerts?: Array<Record<string, unknown>>;
  monitor_runs?: Array<Record<string, unknown>>;
  enrollment_discovery?: Array<Record<string, unknown>>;
  snapshot_version?: number;
}): {
  snapshot: typeof snapshot & { snapshot_version: number };
  dropped_demo_drafts: number;
} {
  const purchases = snapshot.purchases ?? [];
  const kept = purchases.filter((p) => !isUnconfirmedDemoPurchaseRow(p));
  const dropped = purchases.length - kept.length;
  const keepIds = new Set(kept.map((p) => String(p.id)));

  const filterByPurchase = <T extends Record<string, unknown>>(
    rows: T[] | undefined,
  ): T[] =>
    (rows ?? []).filter((r) => {
      const pid = r.purchase_id;
      if (pid == null) return true;
      return keepIds.has(String(pid));
    });

  return {
    dropped_demo_drafts: dropped,
    snapshot: {
      ...snapshot,
      snapshot_version: SESSION_SNAPSHOT_VERSION,
      purchases: kept,
      product_fingerprints: filterByPurchase(snapshot.product_fingerprints),
      product_matches: filterByPurchase(snapshot.product_matches),
      price_observations: filterByPurchase(snapshot.price_observations),
      alerts: filterByPurchase(snapshot.alerts),
      monitor_runs: filterByPurchase(snapshot.monitor_runs),
      enrollment_discovery: filterByPurchase(snapshot.enrollment_discovery),
    },
  };
}
