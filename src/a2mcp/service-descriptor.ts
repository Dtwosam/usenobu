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
      "monitoring_pass_token",
      "quote_id",
      "connection_id",
      "connection_token",
    ],
    optional_fields: [],
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
  service: string;
  agent: string;
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
};

/**
 * Pure — no network, database, AI, or email work. Safe to return on the
 * hot path of an unshaped first contact.
 */
export function buildFreeServiceDescriptor(): FreeServiceDescriptor {
  return {
    agent_state: "SERVICE_DESCRIPTOR",
    status: "READY",
    service: "Nobu Purchase Setup",
    agent: "Nobu — AI post-purchase monitoring agent",
    message:
      "Nobu is ready. Send a JSON body with an `action` field and that action's required fields. This response lists every supported action and a working example.",
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
        "Buys one Nobu Monitoring Pass. Redeem it here with REDEEM_MONITORING_PASS to activate monitoring for one confirmed eligible Target purchase.",
    },
    retailer_support:
      "Target is currently the only supported retailer. Target verifies eligibility and makes the final decision.",
    documentation: NOBU_DOCUMENTATION_URL,
    next_action:
      "Send UNDERSTAND_PURCHASE with the purchase description, or DISCOVER_PRODUCT with structured purchase fields.",
  };
}

/**
 * True when a parsed request body carries no action this service recognises —
 * a bodyless call, `{}`, a `message`/`query`/`prompt` envelope, or any other
 * unshaped payload. Those callers get the descriptor instead of a 400.
 *
 * A recognised action always falls through to the normal dispatcher, so
 * existing valid actions and their validation errors are unchanged.
 */
export function isFirstContactRequest(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return true;
  const action = (raw as { action?: unknown }).action;
  if (typeof action !== "string") return true;
  return !FREE_AGENT_ACTION_NAMES.includes(action);
}
