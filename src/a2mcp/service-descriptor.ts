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
 *
 * Marketplace generic first contact now returns SERVICE_SELECTION_REQUIRED
 * from the canonical service catalogue (see service-catalogue.ts). This file
 * retains the low-level free-service action list and READY descriptor for
 * protocol callers that already know they are on Purchase Setup.
 */

import {
  buildFreeCatalogueService,
  buildPaidCatalogueService,
  DESCRIBE_SERVICES_ACTION,
  FREE_SERVICE_ID,
  FREE_SERVICE_NAME,
  listAvailableServices,
  NOBU_DOCUMENTATION_URL,
  PAID_SERVICE_ID,
  PAID_SERVICE_NAME,
  PAID_SERVICE_PRICE_LABEL,
  SELECT_SERVICE_ACTION,
  SERVICE_SELECTION_CALLING_AGENT_GUIDANCE,
  type CatalogueService,
} from "./service-catalogue.js";

export { NOBU_DOCUMENTATION_URL };

/** Every action the free A2MCP service accepts, with its required fields. */
export const FREE_AGENT_ACTIONS = [
  {
    action: DESCRIBE_SERVICES_ACTION,
    summary:
      "List both registered Nobu services. Calling agents should invoke this automatically on generic Agent-5541 contact; never ask the user for an internal action name.",
    required_fields: ["action"],
    optional_fields: [],
  },
  {
    action: SELECT_SERVICE_ACTION,
    summary:
      "Select exactly one registered service by service_id (33561 free or 35958 paid).",
    required_fields: ["action", "service_id"],
    optional_fields: [],
  },
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

/** Action names recognised by the free dispatcher (incl. service discovery). */
export const FREE_AGENT_ACTION_NAMES: readonly string[] =
  FREE_AGENT_ACTIONS.map((a) => a.action);

export type FreeServiceDescriptor = {
  agent_state: "SERVICE_DESCRIPTOR";
  status: "READY";
  agent: string;
  introduction: string;
  service: string;
  service_id: typeof FREE_SERVICE_ID;
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
  available_services: readonly CatalogueService[];
  paid_service: {
    service_id: typeof PAID_SERVICE_ID;
    name: string;
    endpoint: string;
    price: string;
    description: string;
  };
  retailer_support: string;
  documentation: string;
  next_action: string;
  completed_step: string;
  payment_status: "not_required";
  second_payment_required: false;
  monitoring_active: false;
  journey_complete: false;
  retry_safe: true;
  input_required: false;
  fields?: readonly string[];
  requiredArgs?: readonly string[];
  required_user_input: Record<string, unknown> | null;
  guidance: string;
};

export type FreeServiceInputRequired = {
  agent_state: "SERVICE_INPUT";
  status: "input_required";
  agent: string;
  introduction: string;
  service: string;
  service_id: typeof FREE_SERVICE_ID;
  message: string;
  protocol: string;
  request: FreeServiceDescriptor["request"];
  supported_actions: typeof FREE_AGENT_ACTIONS;
  recommended_first_action: typeof DESCRIBE_SERVICES_ACTION;
  example_request: Record<string, unknown>;
  available_services: readonly CatalogueService[];
  paid_service: FreeServiceDescriptor["paid_service"];
  retailer_support: string;
  documentation: string;
  next_action: typeof DESCRIBE_SERVICES_ACTION;
  completed_step: string;
  payment_status: "not_required";
  second_payment_required: false;
  monitoring_active: false;
  journey_complete: false;
  retry_safe: true;
  input_required: true;
  fields: readonly ["action"];
  requiredArgs: readonly ["action"];
  required_user_input: {
    action: typeof DESCRIBE_SERVICES_ACTION;
    required_fields: readonly [];
    description: string;
  };
  guidance: string;
  auto_invoke: typeof DESCRIBE_SERVICES_ACTION;
  do_not_ask_user_for_internal_action: true;
};

/**
 * Pure — no network, database, AI, or email work. Safe to return on the
 * hot path of an unshaped first contact.
 *
 * Free Purchase Setup never requires payment. Paid Monitoring Pass is listed
 * via available_services / paid_service with its own registered endpoint.
 */
export function buildFreeServiceDescriptor(): FreeServiceDescriptor {
  const free = buildFreeCatalogueService();
  const paid = buildPaidCatalogueService();
  return {
    agent_state: "SERVICE_DESCRIPTOR",
    status: "READY",
    introduction:
      "Nobu monitors exact Target online purchases and alerts when a safely matched lower price may create a chance to request an adjustment. Target decides any refund.",
    service: FREE_SERVICE_NAME,
    service_id: FREE_SERVICE_ID,
    agent: "Nobu — AI post-purchase monitoring agent",
    message:
      "You are on free Nobu Purchase Setup (33561). It does not sell a Monitoring Pass and does not activate monitoring by first contact alone. Paid Monitoring Pass is service 35958 at its own endpoint.",
    protocol: "A2MCP",
    request: {
      method: "POST",
      content_type: "application/json",
      envelope: '{"action":"<ACTION>", ...required fields}',
    },
    supported_actions: FREE_AGENT_ACTIONS,
    recommended_first_action: DESCRIBE_SERVICES_ACTION,
    example_request: {
      action: DESCRIBE_SERVICES_ACTION,
    },
    available_services: listAvailableServices(),
    paid_service: {
      service_id: PAID_SERVICE_ID,
      name: paid.name,
      endpoint: paid.endpoint,
      price: paid.price,
      description: paid.description,
    },
    retailer_support:
      "Target only for MVP. Target makes the final adjustment decision.",
    documentation: NOBU_DOCUMENTATION_URL,
    next_action: DESCRIBE_SERVICES_ACTION,
    completed_step: "NOBU_INTRODUCED",
    payment_status: "not_required",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    input_required: false,
    fields: [],
    requiredArgs: [],
    required_user_input: null,
    guidance: `${SERVICE_SELECTION_CALLING_AGENT_GUIDANCE} Free service ${FREE_SERVICE_ID} never charges. Paid service ${PAID_SERVICE_ID} is ${PAID_SERVICE_PRICE_LABEL} for one Monitoring Pass only.`,
  };
}

/**
 * Low-level empty free-service probe that still exposes the protocol `action`
 * field for A2MCP compatibility. Instructs the calling agent to invoke
 * DESCRIBE_SERVICES automatically — never ask the end user for an internal
 * action name. Payment is not required on free Purchase Setup.
 *
 * Marketplace generic first contact prefers buildServiceSelectionRequired().
 */
export function buildFreeServiceInputRequired(): FreeServiceInputRequired {
  const descriptor = buildFreeServiceDescriptor();
  return {
    agent_state: "SERVICE_INPUT",
    status: "input_required",
    agent: descriptor.agent,
    introduction: descriptor.introduction,
    service: descriptor.service,
    service_id: FREE_SERVICE_ID,
    message:
      "Invoke DESCRIBE_SERVICES automatically to list both Nobu services. Do not ask the user for an internal action name. Do not assume a service from Agent ID alone. Free Purchase Setup (33561) never requires payment.",
    protocol: descriptor.protocol,
    request: descriptor.request,
    supported_actions: FREE_AGENT_ACTIONS,
    recommended_first_action: DESCRIBE_SERVICES_ACTION,
    example_request: { action: DESCRIBE_SERVICES_ACTION },
    available_services: descriptor.available_services,
    paid_service: descriptor.paid_service,
    retailer_support: descriptor.retailer_support,
    documentation: NOBU_DOCUMENTATION_URL,
    next_action: DESCRIBE_SERVICES_ACTION,
    completed_step: "NOBU_INTRODUCED",
    payment_status: "not_required",
    second_payment_required: false,
    monitoring_active: false,
    journey_complete: false,
    retry_safe: true,
    input_required: true,
    fields: ["action"],
    requiredArgs: ["action"],
    required_user_input: {
      action: DESCRIBE_SERVICES_ACTION,
      required_fields: [],
      description:
        "Calling agent: auto-invoke DESCRIBE_SERVICES. Never ask the user to name an internal action or describe Nobu.",
    },
    guidance: SERVICE_SELECTION_CALLING_AGENT_GUIDANCE,
    auto_invoke: DESCRIBE_SERVICES_ACTION,
    do_not_ask_user_for_internal_action: true,
  };
}

/**
 * True when a parsed request body carries no action this service recognises.
 * Those callers get the pure service-selection / first-contact response. A
 * recognised action always falls through to the existing dispatcher unchanged.
 */
export function isFirstContactRequest(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return true;
  const action = (raw as { action?: unknown }).action;
  if (typeof action !== "string") return true;
  return !FREE_AGENT_ACTION_NAMES.includes(action);
}
