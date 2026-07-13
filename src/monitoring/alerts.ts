import { createHash, randomUUID } from "node:crypto";
import { buildAlertDisclaimer } from "./detect.js";
import type { PriceDropAlert } from "./types.js";

/**
 * Deterministic idempotency key for a price-drop alert.
 * Replay of the same purchase/fingerprint/observed price must not create duplicates.
 */
export function buildAlertKey(args: {
  purchase_id: string;
  fingerprint_id: string;
  observed_price: number;
  currency: string;
}): string {
  const priceCents = Math.round(args.observed_price * 100);
  return createHash("sha256")
    .update(
      [
        args.purchase_id,
        args.fingerprint_id,
        String(priceCents),
        args.currency,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export function createPriceDropAlert(args: {
  purchase_id: string;
  fingerprint_id: string;
  observation_id: string;
  purchase_price: number;
  observed_price: number;
  currency: string;
  potential_recovery: number;
  created_at?: string;
  alert_id?: string;
}): PriceDropAlert {
  const created_at = args.created_at ?? new Date().toISOString();
  const alert_key = buildAlertKey({
    purchase_id: args.purchase_id,
    fingerprint_id: args.fingerprint_id,
    observed_price: args.observed_price,
    currency: args.currency,
  });

  return {
    id: args.alert_id ?? `alert_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    purchase_id: args.purchase_id,
    fingerprint_id: args.fingerprint_id,
    observation_id: args.observation_id,
    purchase_price: args.purchase_price,
    observed_price: args.observed_price,
    potential_recovery: args.potential_recovery,
    currency: args.currency,
    alert_key,
    status: "PRICE_DROP_DETECTED",
    disclaimer: buildAlertDisclaimer(),
    created_at,
  };
}
