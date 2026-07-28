/**
 * Lane 8R.3B — A2MCP first-contact descriptor for the free service.
 *
 * OKX's platform test and any first-time caller reach the registered endpoint
 * with no recognised action: a bodyless POST, `{}`, or a natural-language
 * envelope (`message` / `query` / `prompt`). Before this lane every one of
 * those answered `400`, so a caller could never learn what to send and the
 * review task timed out (`docs/proof/lane-8r-3a-timeout-diagnosis/`).
 *
 * This module is deliberately pure: building the descriptor performs no
 * Groq, SerpApi, email, or Postgres work, so first contact cannot inherit any
 * dependency's latency or failure mode.
 */

/** Public customer guide referenced from machine-readable responses. */
export const NOBU_DOCUMENTATION_URL = "https://www.usenobu.xyz/okx";

/** Every action the free A2MCP service accepts, with its required fields. */
export const FREE_AGENT_ACTIONS = [
  {
    action: "UNDERSTAND_PURCHASE",
    summary:
      "Extract structured purchase fields from a plain-English purchase description.",
    required_fields: ["action", "purchase_text"],
    optional_fields: [],
  },
  {
    action: "DISCOVER_PRODUCT",
    summary:
      "Find bounded Target product candidates for a purchase. Start here when the exact product is not confirmed yet.",
    required_fields: ["action", "purchase"],
    optional_fields: [],
  },
  {
    action: "CONFIRM_PRODUCT",
    summary:
      "Confirm exactly one discovered candidate and lock the product fingerprint.",
    required_fields: ["action", "discovery_session_id", "candidate_id"],
    optional_fields: [],
  },
  {
    action: "CHECK_CONFIRMED_PURCHASE",
    summary:
      "Run a one-off Target price check for an already-confirmed purchase. No monitoring is started.",
    required_fields: [
      "action",
      "target_product_url",
      "purchase_price",
      "currency",
      "purchase_date",
      "country",
      "purchase_channel",
    ],
    optional_fields: [
      "region",
      "model_number",
      "upc_or_gtin",
      "target_item_id",
      "user_confirmed_match_id",
    ],
  },
  {
    action: "BEGIN_EMAIL_VERIFICATION",
    summary: "Send a six-digit code to the email that should receive alerts.",
    required_fields: ["action", "email"],
    optional_fields: [],
  },
  {
    action: "VERIFY_EMAIL_CODE",
    summary:
      "Verify the emailed code and receive the connection credentials used by later actions.",
    required_fields: ["action", "connection_id", "code"],
    optional_fields: [],
  },
  {
    action: "PREFLIGHT_MONITORING",
    summary:
      "Record consent, check Target eligibility, and issue the enrollment quote redeemed with a Monitoring Pass.",
    required_fields: [
      "action",
      "connection_id",
      "connection_token",
      "discovery_session_id",
      "monitoring_consent",
      "email_alert_consent",
    ],
    optional_fields: [],
  },
  {
    action: "REDEEM_MONITORING_PASS",
    summary:
      "Redeem a paid Nobu Monitoring Pass to activate monitoring for one confirmed eligible purchase.",
    required_fields: [
      "action",
      "monitoring_pass_id",
      "quote_id",
      "connection_id",
      "connection_token",
    ],
    optional_fields: [],
  },
  {
    action: "RESOLVE_MONITORING_PASS",
    summary:
      "Look up a paid Monitoring Pass by pass_continuation_id or monitoring_pass_id after settlement. Does not start monitoring and never charges again.",
    required_fields: ["action"],
    optional_fields: ["pass_continuation_id", "monitoring_pass_id"],
  },
  {
    action: "CHECK_MONITORING_STATUS",
    summary: "Read the current monitoring status for one purchase.",
    required_fields: ["action", "purchase_id"],
    optional_fields: ["connection_id", "connection_token"],
  },
  {
    action: "LIST_ACTIVE_MONITORS",
    summary: "List the monitors this connection currently owns.",
    required_fields: ["action", "connection_id", "connection_token"],
    optional_fields: [],
  },
  {
    action: "ENABLE_EMAIL_ALERTS",
    summary: "Turn on price-drop email alerts for one purchase.",
    required_fields: [
      "action",
      "connection_id",
      "connection_token",
      "purchase_id",
    ],
    optional_fields: [],
  },
  {
    action: "DISABLE_EMAIL_ALERTS",
    summary: "Turn off price-drop email alerts for one purchase.",
    required_fields: [
      "action",
      "connection_id",
      "connection_token",
      "purchase_id",
    ],
    optional_fields: [],
  },
  {
    action: "STOP_MONITORING",
    summary:
      "Stop monitoring one purchase. Purchase history is kept; this never implies a refund.",
    required_fields: [
      "action",
      "connection_id",
      "connection_token",
      "purchase_id",
    ],
    optional_fields: [],
  },
  {
    action: "REVOKE_AGENT_CONNECTION",
    summary: "Revoke this connection's credentials.",
    required_fields: ["action", "connection_id", "connection_token"],
    optional_fields: [],
  },
] as const;

/** Action names recognised by the free dispatcher. */
export const FREE_AGENT_ACTION_NAMES: readonly string[] =
  FREE_AGENT_ACTIONS.map((a) => a.action);

export type FreeServiceDescriptor = {
  agent_state: "SERVICE_DESCRIPTOR";
  status: "READY";
  agent: string;
  introduction: string;
  service: string;
  message: string;
  protocol: string;
  request: {
    method: string;
    content_type: string;
    envelope: string;
  };
  supported_actions: typeof FREE_AGENT_ACTIONS;
  recommended_first_action: string;
  example_request: Record<string, unknown>;
  paid_service: {
    name: string;
    endpoint: string;
    price: string;
    description: string;
  };
  retailer_support: string;
  documentation: string;
  next_action: string;
  completed_step: string;
  payment_status: "required" | "not_required" | "pending" | "recognized";
  second_payment_required: false;
  monitoring_active: false;
  journey_complete: false;
  retry_safe: true;
  fields?: readonly string[];
  requiredArgs?: readonly string[];
  required_user_input: Record<string, unknown>;
  guidance: string;
};

export type FreeServiceInputRequired = Omit<
  FreeServiceDescriptor,
  "agent_state" | "status" | "message"
> & {
  agent_state: "SERVICE_INPUT";
  status: "input_required";
  message: string;
  fields: readonly ["action"];
  requiredArgs: readonly ["action"];
};

/**
 * Pure — no network, database, AI, or email work. Safe to return on the
 * hot path of an unshaped first contact.
 */
export function buildFreeServiceDescriptor(): FreeServiceDescriptor {
  return {
    agent_state: "SERVICE_DESCRIPTOR",
    status: "READY",
    introduction:
      "Nobu monitors exact Target online purchases and alerts when a safely matched lower price may create a chance to request an adjustment. Target decides any refund.",
    service: "Nobu Purchase Setup",
    agent: "Nobu — AI post-purchase monitoring agent",
    message:
      "Purchase Setup (33561) is free. Monitoring Pass (35958) is 0.99 USDT once and does not start monitoring. Choose one next step.",
    protocol: "A2MCP",
    request: {
      method: "POST",
      content_type: "application/json",
      envelope: '{"action":"<ACTION>", ...required fields}',
    },
    supported_actions: FREE_AGENT_ACTIONS,
    recommended_first_action: "UNDERSTAND_PURCHASE",
    example_request: {
      action: "UNDERSTAND_PURCHASE",
      purchase_text:
        "I bought an Apple AirTag from Target online on 2026-07-20 for $29.99",
    },
    paid_service: {
      name: "Nobu Monitoring Pass",
      endpoint: "https://usenobu.vercel.app/v1/agent/monitoring-pass",
      price: "0.99 USDT",
      description:
        "One Monitoring Pass only. Does not activate monitoring. One quote, one payment; never re-quote on balance_unavailable.",
    },
    retailer_support:
      "Target only for MVP. Target makes the final adjustment decision.",
    documentation: NOBU_DOCUMENTATION_URL,
    next_action:
      "No pass yet → service 35958 once (one quote only). Already paid → RESOLVE_MONITORING_PASS with pass_continuation_id or monitoring_pass_id. Pass ready → purchase description only.",
    completed_step: "NOBU_INTRODUCED",
    payment_status: "required",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    fields: ["action"],
    requiredArgs: ["action"],
    required_user_input: {
      action: "UNDERSTAND_PURCHASE",
      required_fields: ["purchase_text"],
      description:
        "If the user already has a pass, send purchase_text only. Otherwise route to service 35958 once first.",
    },
    guidance:
      "Explain both services once: free 33561 vs paid 35958 (0.99 USDT). One deliberate payment quote only; never re-quote on balance_unavailable. After payment, never request a second charge. Setup order: pass → purchase details → discovery → exact confirm → email → code → both consents → redeem. Never guarantee a Target adjustment.",
  };
}

/**
 * Official Onchain OS 4.4.0 endpoint validation treats this 400 response as
 * an input-required service and uses `requiredArgs`/`fields` to continue its
 * service-input flow. `action` is the only field required by every request;
 * `supported_actions` truthfully declares each action's remaining fields.
 */
export function buildFreeServiceInputRequired(): FreeServiceInputRequired {
  const descriptor = buildFreeServiceDescriptor();
  return {
    ...descriptor,
    agent_state: "SERVICE_INPUT",
    status: "input_required",
    message:
      "Purchase Setup is free (no x402). No pass yet: use service 35958 once (0.99 USDT, one quote). Already paid: send monitoring_pass_id or pass_continuation_id / RESOLVE. Pass ready: send a purchase description action.",
    fields: ["action"],
    requiredArgs: ["action"],
  };
}

/**
 * True when a parsed request body carries no action this service recognises.
 * Those callers get the pure input-required response. A recognised action
 * always falls through to the existing dispatcher unchanged.
 */
export function isFirstContactRequest(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return true;
  const action = (raw as { action?: unknown }).action;
  if (typeof action !== "string") return true;
  return !FREE_AGENT_ACTION_NAMES.includes(action);
}
