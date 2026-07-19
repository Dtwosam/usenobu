/**
 * Locked Target U.S. online price-match policy snapshot.
 * Facts mirror data/retailer-policies/target-us-v1.yaml — do not invent policy rules.
 *
 * Operational review metadata is separate (src/policy/operations/). The 24-hour
 * interval is an owner-review reminder, not a production shutdown timer.
 */

import { POLICY_ID_TARGET_US_V1 } from "../domain/enums.js";

export const TARGET_US_POLICY = {
  policy_id: POLICY_ID_TARGET_US_V1,
  policy_version: "v1",
  retailer_id: "target",
  jurisdiction: "US",
  purchase_channel: "online",
  status: "active_freshness_sensitive",
  /**
   * Last verified against official Target help page (ISO-8601).
   * Reverified Lane 8-R1A against official Target Price Match Guarantee source
   * (web corroboration of official Target.com help content when direct page
   * fetch returned Target capacity page). Substantive rules unchanged.
   */
  verified_at: "2026-07-19T18:00:00.000Z",
  /** approved_at alias for ops seed — same as verification of this approved snapshot. */
  approved_at: "2026-07-19T18:00:00.000Z",
  source_url:
    "https://www.target.com/help/articles/policies-guidelines/price-match-guarantee",
  /**
   * Optional normalized fingerprint of owner-confirmed source notes.
   * Not scraped; set only after manual owner verification.
   */
  source_fingerprint: "target-pmg-14d-receipt-required-v1" as string | null,
  window: {
    type: "calendar_days_after_purchase" as const,
    days: 14,
  },
  supported: {
    seller: "target" as const,
    target_plus: false,
    alaska: false,
    hawaii: false,
  },
  /** U.S. region codes excluded from MVP (contract + YAML). */
  unsupported_regions: ["AK", "HI"] as const,
  requirements: {
    original_receipt_or_packing_slip: true,
    price_must_be_listed_and_valid: true,
    retailer_verifies_price: true,
  },
  excluded_categories: [
    "clearance",
    "closeout",
    "liquidation",
    "damaged",
    "used",
    "open_package",
    "refurbished",
    "pre_owned",
    "rent_lease_to_own",
    "total_store_discount",
    "minimum_purchase_deal",
    "typographical_error",
    "credit_card_offer",
    "gift_card_offer",
    "financing_offer",
    "service_offer",
    "bundle_offer",
    "tax_promotion",
    "free_item",
    "rebate",
    "mail_in_offer",
    "contract_mobile_device",
    "optical",
    "warranty_or_product_service",
    "clinic",
    "pharmacy",
    "preorder",
    "target_plus",
  ] as const,
  /**
   * Ambiguous commercial conditions represented in user input that fail closed
   * without inventing eligibility (contract: coupons/bonuses, unknown conditions).
   */
  fail_closed_ambiguous_exclusions: [
    "coupon_or_bonus_ambiguity",
    "coupon",
    "bonus",
    "unknown",
  ] as const,
  claim_route: {
    online_chat: true,
    guest_services_phone: "1-800-591-3869",
    /** Official Target Contact Us (reverified 2026-07-19). Does not auto-start chat. */
    contact_url: "https://www.target.com/help/contact-us",
  },
  final_decision_by: "Target" as const,
  maximum_positive_language: "potentially_eligible" as const,
  /**
   * Operational review interval (hours). Owner-review reminder only.
   * Overdue review → CHECK_DUE (continue service with warning), not POLICY_STALE.
   */
  review_interval_hours: 24,
  /**
   * @deprecated Use review_interval_hours. Kept for transitional callers.
   * No longer forces POLICY_STALE solely by age.
   */
  max_freshness_hours: 24,
  /** Bound grace while source is SOURCE_UNAVAILABLE before non-positive block. */
  source_unavailable_grace_hours: 72,
} as const;

export type TargetUsPolicy = typeof TARGET_US_POLICY;

export const DEFAULT_POLICY_DISCLAIMER =
  "Observed Target price is third-party data. Target must verify the lower price and makes the final decision. Nobu does not guarantee a refund.";
