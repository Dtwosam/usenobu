/**
 * Shared PolicyOperationsStore contract (Lane 8-R2A).
 * All production consumers must use one durable shared store.
 */

import type {
  OwnerReviewAction,
  PolicyOperationsRecord,
  PolicyOwnerAlert,
  PolicyPendingReview,
  PolicyReviewEvent,
  PolicyRuntimeView,
} from "./types.js";

export type PolicyStoreKind = "memory" | "sqlite" | "postgres";

export interface EnsureOwnerAlertArgs {
  policy_id: string;
  policy_version: string;
  alert_type: string;
  message: string;
  nowIso: string;
}

export interface InsertPendingReviewArgs {
  policy_id: string;
  from_version: string;
  note: string | null;
  previous_approved_state: string | null;
  detected_state: string | null;
  nowIso: string;
}

export interface InsertReviewEventArgs {
  policy_id: string;
  policy_version: string;
  action: string;
  note: string | null;
  actor: string;
  previous_state: string | null;
  resulting_state: string | null;
  nowIso: string;
  payload?: unknown;
}

export interface ApplyOwnerReviewArgs {
  action: OwnerReviewAction;
  note?: string | null;
  actor: string;
  nowIso?: string;
}

export interface ApplyOwnerReviewResult {
  ok: true;
  record: PolicyOperationsRecord;
  pending_review_id?: string;
}

export interface SchedulerResult {
  transitioned: boolean;
  alert_created: boolean;
  runtime: PolicyRuntimeView;
}

export interface PolicyStatusSnapshot {
  runtime: PolicyRuntimeView;
  active_owner_alerts: number;
  pending_reviews: number;
  alerts: PolicyOwnerAlert[];
  store_kind: PolicyStoreKind;
}

/**
 * Durable policy-operations persistence. Adapters: postgres (prod), sqlite (local),
 * memory (explicit unit tests only).
 */
export interface PolicyOperationsStore {
  readonly kind: PolicyStoreKind;

  /** Idempotent schema ensure. */
  ensureSchema(): Promise<void>;

  /**
   * Idempotent seed of the approved Target policy contract when no row exists.
   * Does not overwrite an existing approved row.
   */
  ensureInitialized(nowIso?: string): Promise<PolicyOperationsRecord>;

  getActiveRecord(policyId?: string): Promise<PolicyOperationsRecord | null>;

  upsertRecord(record: PolicyOperationsRecord): Promise<void>;

  /**
   * Create active alert if none for key. Returns true when a new row was inserted.
   * Concurrent inserts remain idempotent via unique alert_key.
   */
  ensureOwnerAlert(args: EnsureOwnerAlertArgs): Promise<boolean>;

  clearActiveOwnerAlerts(
    policyId: string,
    policyVersion: string,
    nowIso: string,
  ): Promise<number>;

  countActiveOwnerAlerts(): Promise<number>;

  listActiveOwnerAlerts(): Promise<PolicyOwnerAlert[]>;

  insertPendingReview(args: InsertPendingReviewArgs): Promise<string>;

  listPendingReviews(): Promise<PolicyPendingReview[]>;

  insertReviewEvent(args: InsertReviewEventArgs): Promise<void>;

  listRecentReviewEvents(limit?: number): Promise<PolicyReviewEvent[]>;

  /**
   * Run work in a single transaction when the adapter supports it.
   * Nested calls may share the outer transaction.
   */
  withTransaction<T>(
    fn: (store: PolicyOperationsStore) => Promise<T>,
  ): Promise<T>;
}

export class PolicyStoreUnavailableError extends Error {
  readonly code = "policy_ops_store_unavailable" as const;

  constructor(message = "policy_ops_store_unavailable") {
    super(message);
    this.name = "PolicyStoreUnavailableError";
  }
}

export function isPolicyStoreUnavailableError(
  err: unknown,
): err is PolicyStoreUnavailableError {
  return (
    err instanceof PolicyStoreUnavailableError ||
    (typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "policy_ops_store_unavailable")
  );
}
