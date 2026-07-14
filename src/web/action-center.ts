/**
 * Action Center helpers — price-drop next steps only.
 * Deterministic copy from stored fields; no secrets or refund guarantees.
 */
import { FIXTURE_UI_LABEL } from "./manual-check-mode.js";
import { formatUsd } from "./status-copy.js";
import {
  resolveTrustedTargetProductUrl,
  TARGET_OFFICIAL_CONTACT_URL,
} from "./target-url.js";

export { FIXTURE_UI_LABEL, TARGET_OFFICIAL_CONTACT_URL };

export const ACTION_TRUST_NOTE =
  "Third-party observed price. Target verifies and decides.";

export const COPY_CLOSING =
  "Confirm the current price on Target.com. Target verifies the price and makes the final decision.";

/** Detect fixture vs live from stored observation (not env alone). */
export function resolveStoredDataSource(observation?: {
  query?: string | null;
  raw_result_hash?: string | null;
  provider?: string | null;
  product_title?: string | null;
  provenance_json?: string | null;
} | null): "LIVE" | "FIXTURE" {
  if (!observation) return "FIXTURE";

  const query = String(observation.query ?? "").toLowerCase();
  const title = String(observation.product_title ?? "").toLowerCase();
  const hash = String(observation.raw_result_hash ?? "");
  const prov = String(observation.provenance_json ?? "").toLowerCase();

  if (
    query.includes("demo-fixture") ||
    query.includes("fixture") ||
    title.includes("demo fixture") ||
    hash ===
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ||
    prov.includes("fixture")
  ) {
    return "FIXTURE";
  }

  if (
    String(observation.provider ?? "").toLowerCase() === "serpapi" &&
    query &&
    !query.includes("fixture")
  ) {
    return "LIVE";
  }

  // Unknown stored rows: label as test so they never look live
  return "FIXTURE";
}

export function shouldShowActionCenter(alert: {
  potential_recovery?: number | string | null;
  observed_price?: number | string | null;
  purchase_price?: number | string | null;
  status?: string | null;
}): boolean {
  const recovery = Number(alert.potential_recovery);
  const observed = Number(alert.observed_price);
  const purchase = Number(alert.purchase_price);
  if (!Number.isFinite(recovery) || recovery <= 0) return false;
  if (!Number.isFinite(observed) || observed <= 0) return false;
  if (!Number.isFinite(purchase) || purchase <= 0) return false;
  if (observed >= purchase) return false;
  return true;
}

export type CopyDetailsInput = {
  product_title?: string | null;
  purchase_date?: string | null;
  purchase_price: number | string;
  observed_price: number | string;
  potential_difference: number | string;
  observed_at?: string | null;
  monitoring_deadline?: string | null;
  target_product_url?: string | null;
  target_item_id?: string | null;
};

/** Plain-text clipboard summary — approved fields only. */
export function buildCopyDetailsText(input: CopyDetailsInput): string {
  const lines = [
    `Product: ${input.product_title?.trim() || "Confirmed Target product"}`,
    `Purchase date: ${input.purchase_date || "—"}`,
    `Purchase price: ${formatUsd(input.purchase_price)}`,
    `Observed price: ${formatUsd(input.observed_price)}`,
    `Potential difference: ${formatUsd(input.potential_difference)}`,
    `Observation time: ${input.observed_at || "—"}`,
    `Monitoring deadline: ${input.monitoring_deadline || "—"}`,
  ];

  if (input.target_product_url) {
    lines.push(`Target product URL: ${input.target_product_url}`);
  } else if (input.target_item_id) {
    lines.push(`Target item ID: ${input.target_item_id}`);
  }

  lines.push(
    "Price source: third-party observation through SerpApi",
    "",
    COPY_CLOSING,
  );

  return lines.join("\n");
}

/** Forbidden substrings that must never appear in copy text. */
export const COPY_FORBIDDEN_PATTERNS = [
  /password/i,
  /card number/i,
  /\bcvv\b/i,
  /ssn|social security/i,
  /guarantees? a refund/i,
  /target owes you/i,
  /email@/i,
  /serpapi_api_key/i,
  /BEGIN (RSA |OPENSSH )?PRIVATE KEY/i,
];

export function copyTextIsSafe(text: string): boolean {
  return !COPY_FORBIDDEN_PATTERNS.some((re) => re.test(text));
}

export function buildActionCenterModel(args: {
  alert: Record<string, unknown>;
  purchase?: Record<string, unknown> | null;
  observation?: Record<string, unknown> | null;
  fingerprint?: Record<string, unknown> | null;
}) {
  const fpUrl =
    (args.fingerprint?.target_product_url as string | undefined) ??
    (args.purchase?.target_product_url as string | undefined);
  const trustedUrl = resolveTrustedTargetProductUrl({
    fingerprint_url: fpUrl,
    purchase_url: args.purchase?.target_product_url as string | undefined,
  });

  const data_source = resolveStoredDataSource(
    args.observation
      ? {
          query: args.observation.query as string | undefined,
          raw_result_hash: args.observation.raw_result_hash as
            | string
            | undefined,
          provider: args.observation.provider as string | undefined,
          product_title: args.observation.product_title as string | undefined,
          provenance_json: args.observation.provenance_json as
            | string
            | undefined,
        }
      : null,
  );

  const show = shouldShowActionCenter({
    potential_recovery: args.alert.potential_recovery as number,
    observed_price: args.alert.observed_price as number,
    purchase_price: args.alert.purchase_price as number,
    status: args.alert.status as string,
  });

  const productTitle =
    (args.fingerprint?.product_title as string | undefined) ||
    (args.observation?.product_title as string | undefined) ||
    "Confirmed Target product";

  const copy_text = buildCopyDetailsText({
    product_title: productTitle,
    purchase_date: args.purchase?.purchase_date as string | undefined,
    purchase_price: String(args.alert.purchase_price),
    observed_price: String(args.alert.observed_price),
    potential_difference: String(args.alert.potential_recovery),
    observed_at:
      (args.observation?.observed_at as string | undefined) ||
      (args.alert.created_at as string | undefined),
    monitoring_deadline: args.purchase?.monitoring_deadline as
      | string
      | undefined,
    target_product_url: trustedUrl,
    target_item_id:
      (args.fingerprint?.target_item_id as string | undefined) ||
      (args.purchase?.target_item_id as string | undefined),
  });

  return {
    show,
    data_source,
    is_fixture: data_source === "FIXTURE",
    trusted_target_url: trustedUrl,
    contact_url: TARGET_OFFICIAL_CONTACT_URL,
    copy_text,
    product_title: productTitle,
    trust_note: ACTION_TRUST_NOTE,
  };
}
