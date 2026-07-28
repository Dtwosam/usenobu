/**
 * Canonical Nobu conversation-response contract.
 *
 * Every Nobu-controlled response should carry these fields so calling agents
 * (including OKX.AI / Onchain OS) always know: what happened, what to do next,
 * whether payment is required/pending/recognized, and whether retry is safe.
 */

export type PaymentStatus =
  | "not_required"
  | "required"
  | "pending"
  | "recognized";

export type ConversationContract = {
  status: string;
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
};

export const NOBU_DOCS = "https://www.usenobu.xyz/okx";

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
  required_fields?: string[] | null;
  required_user_input?: Record<string, unknown> | null;
  pass_continuation_id?: string | null;
  monitoring_pass_id?: string | null;
  journey_id?: string | null;
  next_service_id?: number | null;
  /** Extra machine fields beyond action + required_fields (e.g. journey_id). */
  extra_fields?: string[];
}): ConversationContract {
  const monitoring_active = args.monitoring_active ?? false;
  const journey_complete =
    args.journey_complete ?? monitoring_active;
  const required_fields = args.required_fields ?? null;
  const extra = args.extra_fields ?? [];
  let fields: string[] | null = null;
  if (required_fields && args.next_action) {
    const base = ["action", ...required_fields.filter((f) => f !== "action")];
    fields = [...base, ...extra.filter((f) => !base.includes(f))];
  } else if (extra.length > 0) {
    fields = [...extra];
  } else if (args.next_action) {
    fields = ["action"];
  }

  const required_user_input =
    args.required_user_input !== undefined
      ? args.required_user_input
      : required_fields
        ? {
            action: args.next_action,
            required_fields,
            description: args.message,
          }
        : null;

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
  };

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

/** Marketplace journey incomplete response — one focused input, full contract. */
export function marketplaceIncompleteContract(args: {
  stage:
    | "confirm_use_pass"
    | "purchase_description"
    | "candidate_id"
    | "email"
    | "verification_code"
    | "consents";
  journeyId: string;
  message?: string;
  passContinuationId?: string | null;
  monitoringPassId?: string | null;
}): ConversationContract {
  const stageMeta: Record<
    typeof args.stage,
    { fields: string[]; completed: string; message: string; guidance: string }
  > = {
    confirm_use_pass: {
      fields: ["confirm_use_pass", "journey_id"],
      completed: "MONITORING_PASS_ISSUED",
      message:
        "Your Monitoring Pass is ready. No additional payment is required. Would you like to use it now?",
      guidance:
        "Ask the user to confirm they want to use the pass. Do not request payment, email, or consent yet.",
    },
    purchase_description: {
      fields: ["purchase_description", "journey_id"],
      completed: "PASS_USE_CONFIRMED",
      message:
        "Describe the recent Target online purchase. Provide purchase details only; do not include email or consent.",
      guidance:
        "Collect only the purchase description. Do not ask for email or consent until the exact product is confirmed.",
    },
    candidate_id: {
      fields: ["candidate_id", "journey_id"],
      completed: "PRODUCT_CANDIDATES_FOUND",
      message:
        "Choose the exact Target product candidate. Nobu will not choose or confirm it for you.",
      guidance:
        "Show candidates with differentiating fields. Require the user to select candidate_id. Never auto-confirm.",
    },
    email: {
      fields: ["email", "journey_id"],
      completed: "PRODUCT_CONFIRMED",
      message:
        "The exact product is confirmed. Provide the email address you control for alerts.",
      guidance:
        "Collect only the email for verification. Monitoring is not active.",
    },
    verification_code: {
      fields: ["verification_code", "journey_id"],
      completed: "EMAIL_CODE_SENT",
      message:
        "Enter the six-digit verification code sent to that email address.",
      guidance:
        "Ask for the emailed code. Do not display or log credentials. Monitoring is not active.",
    },
    consents: {
      fields: ["monitoring_consent", "email_alert_consent", "journey_id"],
      completed: "EMAIL_VERIFIED",
      message:
        "Email is verified. Confirm monitoring consent and email-alert consent explicitly.",
      guidance:
        "Both consents must be explicitly true. Target makes any final adjustment decision. Monitoring is not active until redemption succeeds.",
    },
  };

  const meta = stageMeta[args.stage];
  return buildConversationContract({
    status: "input_required",
    completed_step: meta.completed,
    next_action: args.stage,
    message: args.message ?? meta.message,
    guidance: meta.guidance,
    payment_status: "recognized",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    // Marketplace path does not use the free-service action enum.
    required_fields: null,
    required_user_input: {
      required_fields: meta.fields,
      description: args.message ?? meta.message,
    },
    extra_fields: meta.fields,
    journey_id: args.journeyId,
    pass_continuation_id: args.passContinuationId,
    monitoring_pass_id: args.monitoringPassId,
    next_service_id: 33561,
  });
}
