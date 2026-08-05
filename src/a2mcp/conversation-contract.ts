/**
 * Canonical Nobu conversation-response contract.
 *
 * Every Nobu-controlled response should carry these fields so calling agents
 * (including OKX.AI / Onchain OS) always know: what happened, what to do next,
 * whether payment is required/pending/recognized, and whether retry is safe.
 *
 * Important: `next_action` is machine guidance. It does **not** imply that the
 * end user must supply an internal `action` field. Callers that need the free
 * A2MCP protocol `action` field must pass `include_action_field: true` or put
 * `"action"` in `required_fields`.
 *
 * Marketplace stages additionally expose `current_step`, `automatic_continue`,
 * and `machine_continuation` so buyer agents can auto-continue server steps
 * without asking the user to resubmit internal IDs.
 */

import {
  FREE_SERVICE_ID,
  NOBU_DOCUMENTATION_URL,
  resolveFreeServiceEndpoint,
  type EnvRecord,
} from "./service-catalogue.js";

export type PaymentStatus =
  | "not_required"
  | "required"
  | "pending"
  | "recognized";

export type MachineContinuation = {
  method: "POST";
  endpoint: string;
  service_id: typeof FREE_SERVICE_ID;
  body: Record<string, unknown>;
  /** Protocol-only; never present as user-visible required input. */
  do_not_ask_user: true;
};

export type ConversationContract = {
  status: string;
  current_step?: string;
  completed_step: string;
  next_action: string;
  required_user_input: Record<string, unknown> | null;
  fields: string[] | null;
  requiredArgs: string[] | null;
  message: string;
  guidance: string;
  payment_status: PaymentStatus;
  second_payment_required: boolean;
  monitoring_active: boolean;
  journey_complete: boolean;
  retry_safe: boolean;
  documentation: string;
  pass_continuation_id?: string;
  monitoring_pass_id?: string;
  journey_id?: string;
  next_service_id?: number;
  input_required?: boolean;
  required_fields?: string[] | null;
  automatic_continue?: boolean;
  machine_continuation?: MachineContinuation | null;
  /** Protocol replay only — never a user-visible required field. */
  protocol_replay?: Record<string, unknown> | null;
};

export const NOBU_DOCS = NOBU_DOCUMENTATION_URL;

export function buildConversationContract(args: {
  status: string;
  completed_step: string;
  next_action: string;
  message: string;
  guidance: string;
  payment_status: PaymentStatus;
  monitoring_active?: boolean;
  journey_complete?: boolean;
  retry_safe?: boolean;
  second_payment_required?: boolean;
  /**
   * User/machine fields for the next step.
   * - `undefined`: no field list from required_fields (may still use extra_fields)
   * - `null`: same as undefined for legacy callers
   * - `[]`: explicitly no input required → fields/requiredArgs = []
   * - non-empty: those field names (optionally prepend protocol `action`)
   */
  required_fields?: string[] | null;
  required_user_input?: Record<string, unknown> | null;
  pass_continuation_id?: string | null;
  monitoring_pass_id?: string | null;
  journey_id?: string | null;
  next_service_id?: number | null;
  /** Extra machine fields beyond required_fields (e.g. journey_id). */
  extra_fields?: string[];
  /**
   * When true, prepend free-service protocol `action` to fields.
   * Default false — `next_action` alone must not imply user-facing `action`.
   */
  include_action_field?: boolean;
  /** Explicit input_required flag for calling agents. */
  input_required?: boolean;
  current_step?: string | null;
  automatic_continue?: boolean;
  machine_continuation?: MachineContinuation | null;
  protocol_replay?: Record<string, unknown> | null;
}): ConversationContract {
  const monitoring_active = args.monitoring_active ?? false;
  const journey_complete = args.journey_complete ?? monitoring_active;
  const required_fields = args.required_fields;
  const extra = args.extra_fields ?? [];
  const includeAction = args.include_action_field === true;

  let fields: string[] | null = null;
  if (required_fields !== undefined && required_fields !== null) {
    if (required_fields.length === 0 && extra.length === 0) {
      fields = [];
    } else {
      const base = includeAction
        ? [
            "action",
            ...required_fields.filter((f) => f !== "action"),
          ]
        : [...required_fields];
      fields = [...base, ...extra.filter((f) => !base.includes(f))];
    }
  } else if (extra.length > 0) {
    fields = [...extra];
  } else {
    // next_action alone must not invent a user-facing `action` field.
    fields = null;
  }

  const required_user_input =
    args.required_user_input !== undefined
      ? args.required_user_input
      : required_fields && required_fields.length > 0
        ? includeAction
          ? {
              action: args.next_action,
              required_fields,
              description: args.message,
            }
          : {
              required_fields,
              description: args.message,
            }
        : null;

  const input_required =
    args.input_required !== undefined
      ? args.input_required
      : fields !== null && fields.length > 0;

  const contract: ConversationContract = {
    status: args.status,
    completed_step: args.completed_step,
    next_action: args.next_action,
    required_user_input,
    fields,
    requiredArgs: fields,
    message: args.message,
    guidance: args.guidance,
    payment_status: args.payment_status,
    second_payment_required: args.second_payment_required ?? false,
    monitoring_active,
    journey_complete,
    retry_safe: args.retry_safe ?? true,
    documentation: NOBU_DOCS,
    input_required,
    required_fields:
      required_fields !== undefined && required_fields !== null
        ? [...required_fields]
        : fields,
    automatic_continue: args.automatic_continue ?? false,
    machine_continuation:
      args.machine_continuation !== undefined
        ? args.machine_continuation
        : null,
    protocol_replay:
      args.protocol_replay !== undefined ? args.protocol_replay : null,
  };

  if (args.current_step) {
    contract.current_step = args.current_step;
  }
  if (args.pass_continuation_id) {
    contract.pass_continuation_id = args.pass_continuation_id;
  }
  if (args.monitoring_pass_id) {
    contract.monitoring_pass_id = args.monitoring_pass_id;
  }
  if (args.journey_id) {
    contract.journey_id = args.journey_id;
  }
  if (args.next_service_id != null) {
    contract.next_service_id = args.next_service_id;
  }

  return contract;
}

export type MarketplaceStage =
  | "confirm_use_pass"
  | "purchase_description"
  | "product_discovery"
  | "candidate_id"
  | "email"
  | "verification_code"
  | "consents";

function freeSetupContinuation(
  journeyId: string,
  bodyExtras: Record<string, unknown> = {},
  env?: EnvRecord,
): MachineContinuation {
  return {
    method: "POST",
    endpoint: resolveFreeServiceEndpoint(env),
    service_id: FREE_SERVICE_ID,
    body: { journey_id: journeyId, ...bodyExtras },
    do_not_ask_user: true,
  };
}

type StageMeta = {
  /** Durable journey stage name. */
  current_step: MarketplaceStage;
  /** Human-readable next_action token for buyer agents. */
  next_action: string;
  completed: string;
  /** User-visible fields only (never journey_id, never protocol headers). */
  user_fields: string[];
  message: string;
  guidance: string;
  /** Server-to-server step — agent continues without user prompt. */
  automatic: boolean;
  /** Response status for incomplete stage. */
  status: string;
};

const STAGE_META: Record<MarketplaceStage, StageMeta> = {
  confirm_use_pass: {
    current_step: "confirm_use_pass",
    next_action: "CONFIRM_USE_PASS",
    completed: "MONITORING_PASS_ISSUED",
    user_fields: ["confirm_use_pass"],
    message:
      "Your Monitoring Pass is ready. No additional payment is required. Use it now for free Purchase Setup?",
    guidance:
      "Ask only to confirm using the pass. Do not request payment, email, consent, product details, or another endpoint. Continue on free service 33561.",
    automatic: false,
    status: "MONITORING_PASS_ISSUED",
  },
  purchase_description: {
    current_step: "purchase_description",
    next_action: "PROVIDE_PURCHASE_DESCRIPTION",
    completed: "PASS_USE_CONFIRMED",
    user_fields: ["purchase_description"],
    message:
      "Describe the recent Target online purchase only (product, price, date). Do not send email or consent yet.",
    guidance:
      "Collect only purchase details once. Do not ask for email or consent before exact product confirmation. Do not request payment.",
    automatic: false,
    status: "input_required",
  },
  product_discovery: {
    current_step: "product_discovery",
    next_action: "RUN_PRODUCT_DISCOVERY",
    completed: "PURCHASE_DETAILS_CAPTURED",
    user_fields: [],
    message:
      "Purchase details are saved. Continuing automatically to find Target product candidates.",
    guidance:
      "Do not ask the user to resubmit journey_id. POST machine_continuation.body to free service 33561 immediately to run product discovery.",
    automatic: true,
    status: "CONTINUE",
  },
  candidate_id: {
    current_step: "candidate_id",
    next_action: "SELECT_CANDIDATE",
    completed: "PRODUCT_CANDIDATES_FOUND",
    user_fields: ["candidate_id"],
    message:
      "Choose the exact Target product candidate. Nobu will not choose it for you.",
    guidance:
      "Show differentiating fields. Require candidate_id only. Never auto-confirm. Fail closed on wrong seller, Target Plus, or weak matches. Do not ask for email yet.",
    automatic: false,
    status: "input_required",
  },
  email: {
    current_step: "email",
    next_action: "PROVIDE_EMAIL",
    completed: "PRODUCT_CONFIRMED",
    user_fields: ["email"],
    message:
      "Exact product confirmed. Provide the email you control for alerts.",
    guidance:
      "Collect only email for verification. Monitoring is not active. Do not request payment or consent yet.",
    automatic: false,
    status: "input_required",
  },
  verification_code: {
    current_step: "verification_code",
    next_action: "PROVIDE_VERIFICATION_CODE",
    completed: "EMAIL_CODE_SENT",
    user_fields: ["verification_code"],
    message: "Enter the six-digit verification code from that email.",
    guidance:
      "Ask for the six-digit code only. Do not display or log credentials. Monitoring is not active.",
    automatic: false,
    status: "input_required",
  },
  consents: {
    current_step: "consents",
    next_action: "PROVIDE_CONSENTS",
    completed: "EMAIL_VERIFIED",
    user_fields: ["monitoring_consent", "email_alert_consent"],
    message:
      "Email verified. Confirm monitoring consent and email-alert consent (both must be true).",
    guidance:
      "Both consents must be explicitly true. After both are true, Nobu runs eligibility preflight and pass redemption automatically. Target decides any adjustment. Monitoring starts only after successful redemption.",
    automatic: false,
    status: "input_required",
  },
};

/**
 * Marketplace journey stage response — normalized setup contract.
 * Human stages: input_required true, only user fields.
 * Automatic stages: input_required false, automatic_continue true,
 * exact machine_continuation payload (never ask user for journey_id).
 */
export function marketplaceIncompleteContract(args: {
  stage: MarketplaceStage;
  journeyId: string;
  message?: string;
  passContinuationId?: string | null;
  monitoringPassId?: string | null;
  env?: EnvRecord;
  /** Optional candidate list text for candidate_id stage. */
  candidatesMessage?: string;
}): ConversationContract & {
  current_step: string;
  automatic_continue: boolean;
  machine_continuation: MachineContinuation | null;
  journey_id: string;
} {
  const meta = STAGE_META[args.stage];
  const automatic = meta.automatic;
  const userFields = [...meta.user_fields];
  const message =
    args.message ??
    (args.stage === "candidate_id" && args.candidatesMessage
      ? args.candidatesMessage
      : meta.message);

  const machine_continuation = freeSetupContinuation(
    args.journeyId,
    {},
    args.env,
  );

  const contract = buildConversationContract({
    status: meta.status,
    current_step: meta.current_step,
    completed_step: meta.completed,
    next_action: meta.next_action,
    message,
    guidance: meta.guidance,
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    required_fields: userFields,
    required_user_input: automatic
      ? null
      : {
          required_fields: userFields,
          description: message,
        },
    extra_fields: [],
    journey_id: args.journeyId,
    pass_continuation_id: args.passContinuationId,
    monitoring_pass_id: args.monitoringPassId,
    next_service_id: FREE_SERVICE_ID,
    input_required: !automatic,
    automatic_continue: automatic,
    machine_continuation,
    include_action_field: false,
  });

  return {
    ...contract,
    current_step: meta.current_step,
    automatic_continue: automatic,
    machine_continuation,
    journey_id: args.journeyId,
    // Explicit empty arrays for automatic stages (never null ambiguity).
    fields: automatic ? [] : userFields,
    requiredArgs: automatic ? [] : userFields,
    required_fields: automatic ? [] : userFields,
    input_required: !automatic,
  };
}

/** Completed monitoring activation — only after successful pass redemption. */
export function marketplaceMonitoringActiveContract(args: {
  journeyId: string;
  monitoringPassId?: string | null;
  passContinuationId?: string | null;
}): ConversationContract {
  return buildConversationContract({
    status: "MONITORING_ACTIVE",
    current_step: "complete",
    completed_step: "MONITORING_PASS_REDEEMED",
    next_action: "CHECK_MONITORING_STATUS",
    message:
      "Monitoring is active. A lower price, alert, or adjustment is never guaranteed. Target makes the final decision.",
    guidance:
      "Monitoring is active. Status can be checked later. Stopping keeps history and never implies a refund.",
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: true,
    journey_complete: true,
    retry_safe: true,
    required_fields: [],
    required_user_input: null,
    input_required: false,
    automatic_continue: false,
    machine_continuation: null,
    journey_id: args.journeyId,
    monitoring_pass_id: args.monitoringPassId,
    pass_continuation_id: args.passContinuationId,
    next_service_id: FREE_SERVICE_ID,
  });
}
