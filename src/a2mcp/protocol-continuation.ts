/**
 * Authoritative machine-resumable continuation contract.
 *
 * Buyer agents POST `body` (plus any collected `user_input_fields`) to
 * `endpoint`. Machine-owned values live only in `body` / `machine_fields`.
 * Secrets are listed under `sensitive_fields` and must never be displayed or
 * requested as user input.
 *
 * Neutral typed metadata only — no imperative agent-control prose such as
 * do_not_ask_user / do_not_display / guidance hide/post silently instructions.
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

/**
 * Neutral protocol continuation for paid handoff and marketplace journey.
 * service_id is always free Purchase Setup (33561).
 */
export type ProtocolContinuation = {
  method: "POST";
  endpoint: string;
  service_id: typeof FREE_SERVICE_ID;
  body: Record<string, unknown>;
  /** User fields the buyer agent must collect and merge into body before POST. */
  user_input_fields: string[];
  /** Machine-owned keys already present in body (never ask the user). */
  machine_fields: string[];
  /** Secrets in body that must never be shown or logged. */
  sensitive_fields: string[];
};

/**
 * Legacy mirror of ProtocolContinuation for temporary compatibility.
 * Must always be identical to protocol_continuation when both are present.
 */
export type MachineContinuation = ProtocolContinuation;

/** How the buyer should interact for this stage. */
export type InteractionMetadata = {
  mode: "user_input" | "automatic";
  fields: string[];
  confirmation_required: boolean;
};

export function buildUserInputInteraction(fields: string[]): InteractionMetadata {
  return {
    mode: "user_input",
    fields: [...fields],
    confirmation_required: fields.length > 0,
  };
}

export function buildAutomaticInteraction(): InteractionMetadata {
  return {
    mode: "automatic",
    fields: [],
    confirmation_required: false,
  };
}

function machineFieldsFromBody(body: Record<string, unknown>): string[] {
  return Object.keys(body).filter((k) => isMachineOwnedField(k));
}

export function buildProtocolContinuation(args: {
  body: Record<string, unknown>;
  user_input_fields?: string[];
  sensitive_fields?: string[];
  env?: EnvRecord;
}): ProtocolContinuation {
  const body = { ...args.body };
  const user_input_fields = userVisibleFieldsOnly(args.user_input_fields ?? []);
  const sensitive = [...(args.sensitive_fields ?? [])];
  const machine_fields = machineFieldsFromBody(body);
  return {
    method: "POST",
    endpoint: resolveFreeServiceEndpoint(args.env),
    service_id: FREE_SERVICE_ID,
    body,
    user_input_fields,
    machine_fields,
    sensitive_fields: sensitive,
  };
}

/**
 * New paid handoff: journey already ensured at settlement; only ask confirm_use_pass.
 * No secret-bearing automatic POST. Public journey_id is a non-secret workflow handle.
 */
export function buildPaidJourneyHandoffContinuation(args: {
  journeyId: string;
  env?: EnvRecord;
}): ProtocolContinuation {
  return buildProtocolContinuation({
    body: { journey_id: args.journeyId },
    user_input_fields: ["confirm_use_pass"],
    sensitive_fields: [],
    env: args.env,
  });
}

/**
 * Historical recovery only: claim credential path for pre-repair continuations
 * that still carry a credential hash. Never used for newly issued paid responses.
 */
export function buildHistoricalClaimContinuation(args: {
  passContinuationId: string;
  passClaimCredential: string;
  env?: EnvRecord;
}): ProtocolContinuation {
  return buildProtocolContinuation({
    body: {
      pass_continuation_id: args.passContinuationId,
      pass_claim_credential: args.passClaimCredential,
    },
    user_input_fields: [],
    sensitive_fields: ["pass_claim_credential"],
    env: args.env,
  });
}

/** Journey-stage continuation (always carries journey_id). */
export function buildJourneyContinuation(args: {
  journeyId: string;
  bodyExtras?: Record<string, unknown>;
  user_input_fields?: string[];
  sensitive_fields?: string[];
  env?: EnvRecord;
}): ProtocolContinuation {
  return buildProtocolContinuation({
    body: { journey_id: args.journeyId, ...(args.bodyExtras ?? {}) },
    user_input_fields: args.user_input_fields,
    sensitive_fields: args.sensitive_fields,
    env: args.env,
  });
}

/**
 * Strip secrets from any value for logs / safe display.
 * Continuation body secrets become redaction markers.
 */
export function redactSecrets<T>(value: T): T {
  return redactDeep(
    value,
    new Set(SENSITIVE_CONTINUATION_FIELDS.map((s) => s.toLowerCase())),
  ) as T;
}

function redactDeep(value: unknown, sensitiveKeys: Set<string>): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
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
 * Never lists machine-owned field names as something the user should supply.
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
    interaction: buildAutomaticInteraction(),
    message:
      "Internal continuation state is unavailable. Do not pay again. Do not ask the user for tokens or credentials.",
    ...(args.journeyId ? { journey_id: args.journeyId } : {}),
    ...(args.monitoringPassId
      ? { monitoring_pass_id: args.monitoringPassId }
      : {}),
  };
}

/**
 * Unauthorized claim / public-id attempt — HTTP 401 is allowed, but never
 * instruct the user (or buyer agent via required_fields) to supply secrets.
 */
export function claimNotAuthorizedBody(message?: string): Record<string, unknown> {
  return {
    status: "CLAIM_NOT_AUTHORIZED",
    message:
      message ??
      "This request is not authorized to start Purchase Setup. Public identifiers alone cannot continue.",
    monitoring_active: false,
    second_payment_required: false,
    journey_complete: false,
    input_required: false,
    required_fields: [],
    fields: [],
    requiredArgs: [],
    required_user_input: null,
    automatic_continue: false,
    protocol_continuation: null,
    machine_continuation: null,
    interaction: buildAutomaticInteraction(),
    retry_safe: false,
    next_action: "CONTACT_SUPPORT_WITH_JOURNEY_ID",
  };
}

/** Final sanitize so no caller can put machine-owned names in user-input lists. */
export function sanitizeUserInputContractFields<T extends Record<string, unknown>>(
  body: T,
): T {
  const out = { ...body } as Record<string, unknown>;
  for (const key of ["required_fields", "fields", "requiredArgs"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = userVisibleFieldsOnly(out[key] as string[]);
    }
  }
  if (out.required_user_input && typeof out.required_user_input === "object") {
    const rui = { ...(out.required_user_input as Record<string, unknown>) };
    if (Array.isArray(rui.required_fields)) {
      rui.required_fields = userVisibleFieldsOnly(
        rui.required_fields as string[],
      );
    }
    out.required_user_input = rui;
  }
  // Strip imperative agent-control continuation flags if any nested copy leaked.
  if (
    out.protocol_continuation &&
    typeof out.protocol_continuation === "object" &&
    !Array.isArray(out.protocol_continuation)
  ) {
    out.protocol_continuation = sanitizeContinuationObject(
      out.protocol_continuation as Record<string, unknown>,
    );
  }
  if (
    out.machine_continuation &&
    typeof out.machine_continuation === "object" &&
    !Array.isArray(out.machine_continuation)
  ) {
    out.machine_continuation = sanitizeContinuationObject(
      out.machine_continuation as Record<string, unknown>,
    );
  }
  // Neutral marketplace/paid surface: never leave these imperative keys.
  delete out.do_not_ask_user;
  delete out.do_not_display;
  return out as T;
}

function sanitizeContinuationObject(
  cont: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...cont };
  delete next.do_not_ask_user;
  delete next.do_not_display;
  delete next.guidance;
  // Prefer user_input_fields; drop legacy merge_user_fields if both present.
  if (
    Array.isArray(next.merge_user_fields) &&
    !Array.isArray(next.user_input_fields)
  ) {
    next.user_input_fields = userVisibleFieldsOnly(
      next.merge_user_fields as string[],
    );
  }
  delete next.merge_user_fields;
  if (!Array.isArray(next.user_input_fields)) next.user_input_fields = [];
  if (!Array.isArray(next.machine_fields)) {
    next.machine_fields =
      next.body && typeof next.body === "object" && !Array.isArray(next.body)
        ? machineFieldsFromBody(next.body as Record<string, unknown>)
        : [];
  }
  if (!Array.isArray(next.sensitive_fields)) next.sensitive_fields = [];
  next.user_input_fields = userVisibleFieldsOnly(
    next.user_input_fields as string[],
  );
  return next;
}
