/**
 * Authoritative machine-resumable continuation contract.
 *
 * Buyer agents must follow `protocol_continuation` only: POST `body` (plus any
 * `merge_user_fields` collected from the user) to `endpoint`. Never ask the
 * user for machine-owned values; never display `sensitive_fields`.
 */

import {
  FREE_SERVICE_ID,
  resolveFreeServiceEndpoint,
  type EnvRecord,
} from "./service-catalogue.js";

/** Values that are always machine-owned and never user-required. */
export const MACHINE_OWNED_FIELDS = [
  "pass_continuation_id",
  "pass_claim_credential",
  "journey_id",
  "discovery_session_id",
  "connection_id",
  "connection_token",
  "quote_id",
  "monitoring_pass_id",
  "claim_credential",
] as const;

export type MachineOwnedField = (typeof MACHINE_OWNED_FIELDS)[number];

/** Secrets that must never appear in logs or human-readable text. */
export const SENSITIVE_CONTINUATION_FIELDS = [
  "pass_claim_credential",
  "claim_credential",
  "connection_token",
  "payment_signature",
  "authorization",
  "PAYMENT-SIGNATURE",
] as const;

export type ProtocolContinuation = {
  method: "POST";
  endpoint: string;
  service_id: typeof FREE_SERVICE_ID;
  body: Record<string, unknown>;
  /** User fields the buyer agent must collect and merge into body before POST. */
  merge_user_fields?: string[];
  /** Values that must never be shown or logged. */
  sensitive_fields?: string[];
  do_not_ask_user: true;
  do_not_display: true;
};

/**
 * Legacy mirror of ProtocolContinuation for temporary compatibility.
 * Must always be identical to protocol_continuation when both are present.
 */
export type MachineContinuation = ProtocolContinuation;

export function buildProtocolContinuation(args: {
  body: Record<string, unknown>;
  merge_user_fields?: string[];
  sensitive_fields?: string[];
  env?: EnvRecord;
}): ProtocolContinuation {
  const sensitive = args.sensitive_fields?.length
    ? [...args.sensitive_fields]
    : undefined;
  const merge = args.merge_user_fields?.length
    ? [...args.merge_user_fields]
    : undefined;
  const cont: ProtocolContinuation = {
    method: "POST",
    endpoint: resolveFreeServiceEndpoint(args.env),
    service_id: FREE_SERVICE_ID,
    body: { ...args.body },
    do_not_ask_user: true,
    do_not_display: true,
  };
  if (merge) cont.merge_user_fields = merge;
  if (sensitive) cont.sensitive_fields = sensitive;
  return cont;
}

/** Paid-issuance continuation: claim + open journey (no redeem / no confirm). */
export function buildPaidPassContinuation(args: {
  passContinuationId: string;
  passClaimCredential: string;
  env?: EnvRecord;
}): ProtocolContinuation {
  return buildProtocolContinuation({
    body: {
      pass_continuation_id: args.passContinuationId,
      pass_claim_credential: args.passClaimCredential,
    },
    sensitive_fields: ["pass_claim_credential"],
    env: args.env,
  });
}

/** Journey-stage continuation (always carries journey_id). */
export function buildJourneyContinuation(args: {
  journeyId: string;
  bodyExtras?: Record<string, unknown>;
  merge_user_fields?: string[];
  sensitive_fields?: string[];
  env?: EnvRecord;
}): ProtocolContinuation {
  return buildProtocolContinuation({
    body: { journey_id: args.journeyId, ...(args.bodyExtras ?? {}) },
    merge_user_fields: args.merge_user_fields,
    sensitive_fields: args.sensitive_fields,
    env: args.env,
  });
}

/**
 * Strip secrets from any value for logs / safe display.
 * Continuation body secrets become redaction markers.
 */
export function redactSecrets<T>(value: T): T {
  return redactDeep(value, new Set(SENSITIVE_CONTINUATION_FIELDS.map((s) => s.toLowerCase()))) as T;
}

function redactDeep(value: unknown, sensitiveKeys: Set<string>): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    // Never emit long secret-looking tokens in free text when redacting.
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v, sensitiveKeys));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (sensitiveKeys.has(k.toLowerCase())) {
        out[k] = "[redacted]";
      } else if (
        k === "body" &&
        v &&
        typeof v === "object" &&
        !Array.isArray(v)
      ) {
        // Nested continuation body
        out[k] = redactDeep(v, sensitiveKeys);
      } else {
        out[k] = redactDeep(v, sensitiveKeys);
      }
    }
    return out;
  }
  return value;
}

/** True when a field name is machine-owned (never user-required). */
export function isMachineOwnedField(name: string): boolean {
  return (MACHINE_OWNED_FIELDS as readonly string[]).includes(name);
}

/** Filter out machine-owned names from a required-fields list. */
export function userVisibleFieldsOnly(fields: string[]): string[] {
  return fields.filter((f) => !isMachineOwnedField(f));
}

/**
 * INTERNAL_CONTINUATION_STATE_MISSING — never convert to payment or credential ask.
 */
export function internalContinuationStateMissing(args: {
  journeyId?: string | null;
  monitoringPassId?: string | null;
}): Record<string, unknown> {
  return {
    status: "INTERNAL_CONTINUATION_STATE_MISSING",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: false,
    next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
    payment_status: "recognized",
    input_required: false,
    required_fields: [],
    fields: [],
    requiredArgs: [],
    required_user_input: null,
    automatic_continue: false,
    protocol_continuation: null,
    machine_continuation: null,
    message:
      "Internal continuation state is unavailable. Do not pay again. Do not ask the user for tokens or credentials.",
    guidance:
      "Do not request payment, connection_token, pass_claim_credential, or other machine-owned values. Keep the journey_id for support if present.",
    ...(args.journeyId ? { journey_id: args.journeyId } : {}),
    ...(args.monitoringPassId
      ? { monitoring_pass_id: args.monitoringPassId }
      : {}),
  };
}
