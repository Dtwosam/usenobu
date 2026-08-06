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
 * Marketplace stages expose `current_step`, `automatic_continue`, and
 * authoritative `protocol_continuation` (mirrored as `machine_continuation`
 * for temporary compatibility). Buyer agents follow protocol_continuation only.
 */

import {
  FREE_SERVICE_ID,
  NOBU_DOCUMENTATION_URL,
  type EnvRecord,
} from "./service-catalogue.js";
import {
  buildAutomaticInteraction,
  buildJourneyContinuation,
  buildUserInputInteraction,
  sanitizeUserInputContractFields,
  type InteractionMetadata,
  type ProtocolContinuation,
  userVisibleFieldsOnly,
} from "./protocol-continuation.js";

export type {
  InteractionMetadata,
  ProtocolContinuation,
  MachineContinuation,
} from "./protocol-continuation.js";

export type PaymentStatus =
  | "not_required"
  | "required"
  | "pending"
  | "recognized";

export type ConversationContract = {
  status: string;
  current_step?: string;
  completed_step: string;
  next_action: string;
  required_user_input: Record<string, unknown> | null;
  fields: string[] | null;
  requiredArgs: string[] | null;
  message: string;
  /**
   * Legacy free-action prose only. Marketplace journey and paid handoff
   * responses omit this field (neutral typed metadata instead).
   */
  guidance?: string;
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
  /** Neutral interaction metadata for marketplace / paid handoff. */
  interaction?: InteractionMetadata;
  /** Authoritative machine-resumable continuation. */
  protocol_continuation?: ProtocolContinuation | null;
  /**
   * Legacy mirror of protocol_continuation — identical when both present.
   * Prefer protocol_continuation.
   */
  machine_continuation?: ProtocolContinuation | null;
  /** @deprecated Competing continuation path — keep null for marketplace. */
  protocol_replay?: Record<string, unknown> | null;
};

export const NOBU_DOCS = NOBU_DOCUMENTATION_URL;

export function buildConversationContract(args: {
  status: string;
  completed_step: string;
  next_action: string;
  message: string;
  /** Optional; omit on marketplace/paid handoff (neutral typed metadata). */
  guidance?: string;
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
  interaction?: InteractionMetadata;
  /** When true, omit guidance even if provided (marketplace / paid handoff). */
  omit_guidance?: boolean;
  protocol_continuation?: ProtocolContinuation | null;
  machine_continuation?: ProtocolContinuation | null;
  protocol_replay?: Record<string, unknown> | null;
}): ConversationContract {
  const monitoring_active = args.monitoring_active ?? false;
  const journey_complete = args.journey_complete ?? monitoring_active;
  const required_fields = args.required_fields;
  const extra = args.extra_fields ?? [];
  const includeAction = args.include_action_field === true;

  // Never surface machine-owned names as user-required fields.
  const safeRequired =
    required_fields !== undefined && required_fields !== null
      ? userVisibleFieldsOnly(required_fields)
      : required_fields;

  let fields: string[] | null = null;
  if (safeRequired !== undefined && safeRequired !== null) {
    if (safeRequired.length === 0 && extra.length === 0) {
      fields = [];
    } else {
      const base = includeAction
        ? ["action", ...safeRequired.filter((f) => f !== "action")]
        : [...safeRequired];
      fields = [
        ...base,
        ...userVisibleFieldsOnly(extra.filter((f) => !base.includes(f))),
      ];
    }
  } else if (extra.length > 0) {
    fields = userVisibleFieldsOnly([...extra]);
  } else {
    // next_action alone must not invent a user-facing `action` field.
    fields = null;
  }

  // Explicit required_user_input is sanitized so callers cannot bypass the filter.
  let required_user_input: Record<string, unknown> | null;
  if (args.required_user_input !== undefined) {
    if (args.required_user_input === null) {
      required_user_input = null;
    } else {
      const rui = { ...args.required_user_input };
      if (Array.isArray(rui.required_fields)) {
        rui.required_fields = userVisibleFieldsOnly(
          rui.required_fields as string[],
        );
      }
      required_user_input = rui;
    }
  } else if (safeRequired && safeRequired.length > 0) {
    required_user_input = includeAction
      ? {
          action: args.next_action,
          required_fields: safeRequired,
          description: args.message,
        }
      : {
          required_fields: safeRequired,
          description: args.message,
        };
  } else {
    required_user_input = null;
  }

  const input_required =
    args.input_required !== undefined
      ? args.input_required
      : fields !== null && fields.length > 0;

  // protocol_continuation is authoritative; machine_continuation mirrors it.
  const protocol =
    args.protocol_continuation !== undefined
      ? args.protocol_continuation
      : args.machine_continuation !== undefined
        ? args.machine_continuation
        : null;
  const machine =
    args.machine_continuation !== undefined
      ? args.machine_continuation
      : protocol;

  const contract: ConversationContract = {
    status: args.status,
    completed_step: args.completed_step,
    next_action: args.next_action,
    required_user_input,
    fields,
    requiredArgs: fields,
    message: args.message,
    payment_status: args.payment_status,
    second_payment_required: args.second_payment_required ?? false,
    monitoring_active,
    journey_complete,
    retry_safe: args.retry_safe ?? true,
    documentation: NOBU_DOCS,
    input_required,
    required_fields:
      safeRequired !== undefined && safeRequired !== null
        ? [...safeRequired]
        : fields,
    automatic_continue: args.automatic_continue ?? false,
    protocol_continuation: protocol,
    machine_continuation: machine,
    protocol_replay:
      args.protocol_replay !== undefined ? args.protocol_replay : null,
  };

  if (!args.omit_guidance && args.guidance !== undefined) {
    contract.guidance = args.guidance;
  }
  if (args.interaction) {
    contract.interaction = args.interaction;
  }
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

  // Final hard sanitize — no path may leave machine-owned names in user lists.
  return sanitizeUserInputContractFields(
    contract as unknown as Record<string, unknown>,
  ) as ConversationContract;
}

export type MarketplaceStage =
  | "confirm_use_pass"
  | "purchase_description"
  | "product_discovery"
  | "candidate_id"
  | "email"
  | "verification_code"
  | "consents";

type StageMeta = {
  /** Durable journey stage name. */
  current_step: MarketplaceStage;
  /** Human-readable next_action token for buyer agents. */
  next_action: string;
  completed: string;
  /** User-visible fields only (never journey_id, never protocol headers). */
  user_fields: string[];
  message: string;
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
    automatic: false,
    status: "MONITORING_PASS_ISSUED",
  },
  purchase_description: {
    current_step: "purchase_description",
    next_action: "PROVIDE_PURCHASE_DESCRIPTION",
    completed: "PASS_USE_CONFIRMED",
    user_fields: ["purchase_description"],
    message:
      "Provide details of an actual recent Target.com online purchase: actual purchase price, actual purchase date, and a product URL, TCIN, model number, or clear product description. Do not invent details. Custom alert thresholds are not supported.",
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
    automatic: false,
    status: "input_required",
  },
  verification_code: {
    current_step: "verification_code",
    next_action: "PROVIDE_VERIFICATION_CODE",
    completed: "EMAIL_CODE_SENT",
    user_fields: ["verification_code"],
    message: "Enter the six-digit verification code from that email.",
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
    automatic: false,
    status: "input_required",
  },
};

/**
 * Marketplace journey stage response — normalized setup contract.
 * Human stages: input_required true, only user fields; protocol_continuation
 * carries journey_id + user_input_fields.
 * Automatic stages: input_required false, automatic_continue true,
 * protocol_continuation with machine-owned body only.
 * Neutral metadata only — no guidance / do_not_* prose.
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
  /** Extra machine body fields (e.g. connection_token after verification). */
  continuationBodyExtras?: Record<string, unknown>;
  /** Sensitive field names inside continuation body. */
  sensitiveFields?: string[];
}): ConversationContract & {
  current_step: string;
  automatic_continue: boolean;
  protocol_continuation: ProtocolContinuation;
  machine_continuation: ProtocolContinuation;
  journey_id: string;
  interaction: InteractionMetadata;
} {
  const meta = STAGE_META[args.stage];
  const automatic = meta.automatic;
  const userFields = [...meta.user_fields];
  const message =
    args.message ??
    (args.stage === "candidate_id" && args.candidatesMessage
      ? args.candidatesMessage
      : meta.message);

  const protocol_continuation = buildJourneyContinuation({
    journeyId: args.journeyId,
    bodyExtras: args.continuationBodyExtras,
    user_input_fields: automatic ? [] : userFields,
    sensitive_fields: args.sensitiveFields,
    env: args.env,
  });

  const interaction = automatic
    ? buildAutomaticInteraction()
    : buildUserInputInteraction(userFields);

  const contract = buildConversationContract({
    status: meta.status,
    current_step: meta.current_step,
    completed_step: meta.completed,
    next_action: meta.next_action,
    message,
    omit_guidance: true,
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
    interaction,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    include_action_field: false,
    protocol_replay: null,
  });

  return {
    ...contract,
    current_step: meta.current_step,
    automatic_continue: automatic,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    journey_id: args.journeyId,
    fields: automatic ? [] : userFields,
    requiredArgs: automatic ? [] : userFields,
    required_fields: automatic ? [] : userFields,
    input_required: !automatic,
    interaction,
  };
}

/**
 * After discovery fails or returns zero safe candidates: stop automatic loops
 * and ask the user for a clearer purchase description.
 */
export function marketplaceMoreInformationRequired(args: {
  journeyId: string;
  passContinuationId?: string | null;
  monitoringPassId?: string | null;
  message?: string;
  env?: EnvRecord;
}): ConversationContract & {
  current_step: string;
  automatic_continue: false;
  protocol_continuation: ProtocolContinuation;
  machine_continuation: ProtocolContinuation;
  journey_id: string;
  interaction: InteractionMetadata;
} {
  const message =
    args.message ??
    "No safe Target product candidate was found. Provide a clearer product clue such as a Target product URL, TCIN, model number, or fuller product description, plus the actual purchase price and date. Monitoring is not active.";
  const userFields = ["purchase_description"] as const;
  const protocol_continuation = buildJourneyContinuation({
    journeyId: args.journeyId,
    user_input_fields: [...userFields],
    env: args.env,
  });
  const interaction = buildUserInputInteraction([...userFields]);
  const contract = buildConversationContract({
    status: "MORE_INFORMATION_REQUIRED",
    current_step: "purchase_description",
    completed_step: "PRODUCT_DISCOVERY_NO_RESULT",
    next_action: "PROVIDE_PURCHASE_DESCRIPTION",
    message,
    omit_guidance: true,
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    required_fields: [...userFields],
    required_user_input: {
      required_fields: [...userFields],
      description: message,
    },
    journey_id: args.journeyId,
    pass_continuation_id: args.passContinuationId,
    monitoring_pass_id: args.monitoringPassId,
    next_service_id: FREE_SERVICE_ID,
    input_required: true,
    automatic_continue: false,
    interaction,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    include_action_field: false,
    protocol_replay: null,
  });
  return {
    ...contract,
    current_step: "purchase_description",
    automatic_continue: false,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    journey_id: args.journeyId,
    fields: [...userFields],
    requiredArgs: [...userFields],
    required_fields: [...userFields],
    input_required: true,
    interaction,
  };
}

/** Automatic continuation while projection finishes after pass redemption. */
export function marketplaceActivationPendingContract(args: {
  journeyId: string;
  connectionToken: string;
  monitoringPassId?: string | null;
  passContinuationId?: string | null;
  env?: EnvRecord;
}): ConversationContract & {
  current_step: "activation_pending";
  automatic_continue: true;
  protocol_continuation: ProtocolContinuation;
  machine_continuation: ProtocolContinuation;
  journey_id: string;
  interaction: InteractionMetadata;
} {
  const protocol_continuation = buildJourneyContinuation({
    journeyId: args.journeyId,
    bodyExtras: { connection_token: args.connectionToken },
    user_input_fields: [],
    sensitive_fields: ["connection_token"],
    env: args.env,
  });
  const interaction = buildAutomaticInteraction();
  const contract = buildConversationContract({
    status: "ACTIVATION_PENDING",
    current_step: "activation_pending",
    completed_step: "MONITORING_ACTIVATION_PENDING",
    next_action: "RESOLVE_ACTIVATION",
    message:
      "Pass redemption was accepted. Activation is finishing. Do not pay or redeem again.",
    omit_guidance: true,
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    required_fields: [],
    required_user_input: null,
    input_required: false,
    automatic_continue: true,
    interaction,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    journey_id: args.journeyId,
    monitoring_pass_id: args.monitoringPassId,
    pass_continuation_id: args.passContinuationId,
    next_service_id: FREE_SERVICE_ID,
    protocol_replay: null,
  });
  return {
    ...contract,
    current_step: "activation_pending",
    automatic_continue: true,
    protocol_continuation,
    machine_continuation: protocol_continuation,
    journey_id: args.journeyId,
    fields: [],
    requiredArgs: [],
    required_fields: [],
    input_required: false,
    interaction,
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
    omit_guidance: true,
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: true,
    journey_complete: true,
    retry_safe: true,
    required_fields: [],
    required_user_input: null,
    input_required: false,
    automatic_continue: false,
    interaction: buildAutomaticInteraction(),
    protocol_continuation: null,
    machine_continuation: null,
    journey_id: args.journeyId,
    monitoring_pass_id: args.monitoringPassId,
    pass_continuation_id: args.passContinuationId,
    next_service_id: FREE_SERVICE_ID,
    protocol_replay: null,
  });
}
