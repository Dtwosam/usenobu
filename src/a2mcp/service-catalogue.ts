/**
 * Canonical Nobu marketplace service catalogue.
 *
 * Single source of truth for Agent 5541 service ids, names, endpoints, prices,
 * and user-facing descriptions. Used by free first contact, paid 402 bodies,
 * x402 resource descriptions, marketplace journey, OpenAPI, and tests.
 *
 * Free and paid services use distinct registered endpoints — never assume a
 * shared base URL.
 */

export const NOBU_AGENT_ID = 5541 as const;
export const NOBU_AGENT_NAME = "Nobu" as const;

/** Registered free A2MCP service endpoint (ASP service 33561). */
export const DEFAULT_FREE_SERVICE_ENDPOINT =
  "https://usenobu.vercel.app/v1/agent" as const;

/** Registered paid A2MCP service endpoint (ASP service 35958). */
export const DEFAULT_PAID_SERVICE_ENDPOINT =
  "https://www.usenobu.xyz/v1/agent/monitoring-pass" as const;

export const FREE_SERVICE_ID = 33561 as const;
export const PAID_SERVICE_ID = 35958 as const;

export const FREE_SERVICE_NAME = "Nobu Purchase Setup" as const;
export const PAID_SERVICE_NAME = "Nobu Monitoring Pass" as const;

export const PAID_SERVICE_PRICE_USDT = 0.99 as const;
export const PAID_SERVICE_PRICE_LABEL = "0.99 USDT" as const;

/** Public customer guide. */
export const NOBU_DOCUMENTATION_URL = "https://www.usenobu.xyz/okx" as const;

export type ServicePriceKind = "free" | "paid";

export type CatalogueService = {
  service_id: typeof FREE_SERVICE_ID | typeof PAID_SERVICE_ID;
  name: typeof FREE_SERVICE_NAME | typeof PAID_SERVICE_NAME;
  price_kind: ServicePriceKind;
  /** Human-readable price: "free" or "0.99 USDT". */
  price: string;
  /** Numeric USDT amount; 0 for free. */
  price_usdt: number;
  /** Absolute registered HTTPS endpoint for this service. */
  endpoint: string;
  /** Short capability summary for marketplace callers. */
  description: string;
  /** True when this service sells the Monitoring Pass. */
  sells_monitoring_pass: boolean;
  /** True when calling this service alone activates monitoring. */
  activates_monitoring: boolean;
  /** Service parameters required before payment (paid) or first useful call. */
  parameters_required_before_payment: readonly string[];
};

export type EnvRecord = NodeJS.ProcessEnv | Record<string, string | undefined>;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/**
 * Registered free endpoint. Override with NOBU_FREE_SERVICE_ENDPOINT
 * (full URL). Do not derive from the paid host.
 */
export function resolveFreeServiceEndpoint(env: EnvRecord = process.env): string {
  const configured = env.NOBU_FREE_SERVICE_ENDPOINT?.trim();
  if (configured) return trimTrailingSlash(configured);
  return DEFAULT_FREE_SERVICE_ENDPOINT;
}

/**
 * Registered paid endpoint. Override with NOBU_PAID_SERVICE_ENDPOINT
 * (full URL). Do not derive from the free host.
 */
export function resolvePaidServiceEndpoint(env: EnvRecord = process.env): string {
  const configured = env.NOBU_PAID_SERVICE_ENDPOINT?.trim();
  if (configured) return trimTrailingSlash(configured);
  return DEFAULT_PAID_SERVICE_ENDPOINT;
}

const FREE_SERVICE_DESCRIPTION =
  "Free purchase setup, continuation after Monitoring Pass issuance, supported one-time Target price checks, and monitor management. Does not sell a Monitoring Pass and does not activate monitoring by first contact alone. Target is the only live retailer.";

const PAID_SERVICE_DESCRIPTION =
  "One payment of 0.99 USDT issues one Nobu Monitoring Pass. No product details, email, wallet address, alert threshold or other service parameters are needed before payment. Buying the pass does not activate monitoring. After payment, continue free Purchase Setup on service 33561.";

/** x402 resource.description — must match paid pre-payment body meaning. */
export const MONITORING_PASS_RESOURCE_DESCRIPTION = PAID_SERVICE_DESCRIPTION;

export function buildFreeCatalogueService(
  env: EnvRecord = process.env,
): CatalogueService {
  return {
    service_id: FREE_SERVICE_ID,
    name: FREE_SERVICE_NAME,
    price_kind: "free",
    price: "free",
    price_usdt: 0,
    endpoint: resolveFreeServiceEndpoint(env),
    description: FREE_SERVICE_DESCRIPTION,
    sells_monitoring_pass: false,
    activates_monitoring: false,
    parameters_required_before_payment: [],
  };
}

export function buildPaidCatalogueService(
  env: EnvRecord = process.env,
): CatalogueService {
  return {
    service_id: PAID_SERVICE_ID,
    name: PAID_SERVICE_NAME,
    price_kind: "paid",
    price: PAID_SERVICE_PRICE_LABEL,
    price_usdt: PAID_SERVICE_PRICE_USDT,
    endpoint: resolvePaidServiceEndpoint(env),
    description: PAID_SERVICE_DESCRIPTION,
    sells_monitoring_pass: true,
    activates_monitoring: false,
    parameters_required_before_payment: [],
  };
}

/** Both registered services, free first then paid. */
export function listAvailableServices(
  env: EnvRecord = process.env,
): readonly [CatalogueService, CatalogueService] {
  return [buildFreeCatalogueService(env), buildPaidCatalogueService(env)];
}

export function getCatalogueServiceById(
  serviceId: number,
  env: EnvRecord = process.env,
): CatalogueService | null {
  if (serviceId === FREE_SERVICE_ID) return buildFreeCatalogueService(env);
  if (serviceId === PAID_SERVICE_ID) return buildPaidCatalogueService(env);
  return null;
}

/** Machine protocol actions for marketplace service discovery. */
export const DESCRIBE_SERVICES_ACTION = "DESCRIBE_SERVICES" as const;
export const SELECT_SERVICE_ACTION = "SELECT_SERVICE" as const;

export const SERVICE_DISCOVERY_ACTIONS = [
  DESCRIBE_SERVICES_ACTION,
  SELECT_SERVICE_ACTION,
] as const;

export type ServiceDiscoveryAction =
  (typeof SERVICE_DISCOVERY_ACTIONS)[number];

export function isServiceDiscoveryAction(
  action: unknown,
): action is ServiceDiscoveryAction {
  return (
    action === DESCRIBE_SERVICES_ACTION || action === SELECT_SERVICE_ACTION
  );
}

/**
 * Guidance for calling agents on generic Agent-5541 contact.
 * Never ask the end user to describe Nobu or invent service parameters.
 */
export const SERVICE_SELECTION_CALLING_AGENT_GUIDANCE = [
  "Do not assume a service from Agent ID alone.",
  "Do not reuse an earlier service choice without explicit confirmation when the new request is generic.",
  "Present both services and ask which one the user wants.",
  "Do not inspect payment balance before the paid service is selected.",
  "Never ask the user to describe Nobu.",
].join(" ");

export type ServiceSelectionRequiredBody = {
  status: "SERVICE_SELECTION_REQUIRED";
  agent_id: typeof NOBU_AGENT_ID;
  agent_name: typeof NOBU_AGENT_NAME;
  service_selection_required: true;
  available_services: readonly CatalogueService[];
  input_required: true;
  required_fields: readonly ["service_id"];
  fields: readonly ["service_id"];
  requiredArgs: readonly ["service_id"];
  payment_status: "not_required";
  monitoring_active: false;
  journey_complete: false;
  second_payment_required: false;
  retry_safe: true;
  completed_step: "NOBU_INTRODUCED";
  next_action: typeof SELECT_SERVICE_ACTION;
  protocol_actions: readonly [
    typeof DESCRIBE_SERVICES_ACTION,
    typeof SELECT_SERVICE_ACTION,
  ];
  auto_invoke: typeof DESCRIBE_SERVICES_ACTION;
  do_not_ask_user_for_internal_action: true;
  message: string;
  guidance: string;
  documentation: typeof NOBU_DOCUMENTATION_URL;
  required_user_input: {
    required_fields: readonly ["service_id"];
    description: string;
  };
};

/**
 * Generic first contact / DESCRIBE_SERVICES: present both services and require
 * an explicit service_id choice. Payment is not required at this stage.
 */
export function buildServiceSelectionRequired(
  env: EnvRecord = process.env,
): ServiceSelectionRequiredBody {
  const available_services = listAvailableServices(env);
  return {
    status: "SERVICE_SELECTION_REQUIRED",
    agent_id: NOBU_AGENT_ID,
    agent_name: NOBU_AGENT_NAME,
    service_selection_required: true,
    available_services,
    input_required: true,
    required_fields: ["service_id"],
    fields: ["service_id"],
    requiredArgs: ["service_id"],
    payment_status: "not_required",
    monitoring_active: false,
    journey_complete: false,
    second_payment_required: false,
    retry_safe: true,
    completed_step: "NOBU_INTRODUCED",
    next_action: SELECT_SERVICE_ACTION,
    protocol_actions: [DESCRIBE_SERVICES_ACTION, SELECT_SERVICE_ACTION],
    auto_invoke: DESCRIBE_SERVICES_ACTION,
    do_not_ask_user_for_internal_action: true,
    message:
      "Nobu (Agent 5541) offers two services. Choose one by service_id: 33561 Nobu Purchase Setup (free) or 35958 Nobu Monitoring Pass (0.99 USDT). Do not assume a service from the Agent ID alone.",
    guidance: SERVICE_SELECTION_CALLING_AGENT_GUIDANCE,
    documentation: NOBU_DOCUMENTATION_URL,
    required_user_input: {
      required_fields: ["service_id"],
      description:
        "Ask the user which service they want: free Purchase Setup (33561) or paid Monitoring Pass (35958). Send service_id only.",
    },
  };
}

export type FreeServiceSelectedBody = {
  status: "SERVICE_SELECTED";
  agent_id: typeof NOBU_AGENT_ID;
  agent_name: typeof NOBU_AGENT_NAME;
  selected_service_id: typeof FREE_SERVICE_ID;
  selected_service_name: typeof FREE_SERVICE_NAME;
  available_services: readonly CatalogueService[];
  service_confirmation_required: false;
  input_required: false;
  required_fields: readonly [];
  fields: readonly [];
  requiredArgs: readonly [];
  required_user_input: null;
  payment_status: "not_required";
  monitoring_active: false;
  journey_complete: false;
  second_payment_required: false;
  retry_safe: true;
  completed_step: "SERVICE_SELECTED";
  next_action: "CONTINUE_PURCHASE_SETUP";
  next_service_id: typeof FREE_SERVICE_ID;
  service: CatalogueService;
  message: string;
  guidance: string;
  documentation: typeof NOBU_DOCUMENTATION_URL;
};

export type PaidServiceSelectedBody = {
  status: "SERVICE_SELECTED";
  agent_id: typeof NOBU_AGENT_ID;
  agent_name: typeof NOBU_AGENT_NAME;
  selected_service_id: typeof PAID_SERVICE_ID;
  selected_service_name: typeof PAID_SERVICE_NAME;
  available_services: readonly CatalogueService[];
  service_confirmation_required: true;
  input_required: false;
  required_fields: readonly [];
  fields: readonly [];
  requiredArgs: readonly [];
  required_user_input: null;
  product_details_required_before_payment: false;
  email_required_before_payment: false;
  alert_threshold_required: false;
  wallet_address_required_as_service_input: false;
  payment_status: "required";
  monitoring_active: false;
  journey_complete: false;
  second_payment_required: false;
  retry_safe: true;
  completed_step: "SERVICE_SELECTED";
  next_action: "CALL_PAID_MONITORING_PASS_ENDPOINT";
  next_service_id: typeof PAID_SERVICE_ID;
  service: CatalogueService;
  service_description: string;
  deliverable: { type: "monitoring_pass"; quantity: 1 };
  paid_endpoint: string;
  message: string;
  guidance: string;
  documentation: typeof NOBU_DOCUMENTATION_URL;
};

export type ServiceSelectionErrorBody = ServiceSelectionRequiredBody & {
  error: "unknown_service_id" | "service_id_required";
};

/**
 * SELECT_SERVICE handler. Requires explicit numeric service_id.
 * Never assumes a service from Agent ID alone.
 */
export function buildServiceSelectedResponse(
  raw: unknown,
  env: EnvRecord = process.env,
): {
  http_status: 200 | 400;
  body:
    | FreeServiceSelectedBody
    | PaidServiceSelectedBody
    | ServiceSelectionErrorBody;
} {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const rawId = body.service_id;
  const serviceId =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string" && /^\d+$/.test(rawId.trim())
        ? Number(rawId.trim())
        : null;

  if (serviceId == null) {
    return {
      http_status: 400,
      body: {
        ...buildServiceSelectionRequired(env),
        error: "service_id_required",
      },
    };
  }

  const free = buildFreeCatalogueService(env);
  const paid = buildPaidCatalogueService(env);
  const available_services = [free, paid] as const;

  if (serviceId === FREE_SERVICE_ID) {
    return {
      http_status: 200,
      body: {
        status: "SERVICE_SELECTED",
        agent_id: NOBU_AGENT_ID,
        agent_name: NOBU_AGENT_NAME,
        selected_service_id: FREE_SERVICE_ID,
        selected_service_name: FREE_SERVICE_NAME,
        available_services,
        service_confirmation_required: false,
        input_required: false,
        required_fields: [],
        fields: [],
        requiredArgs: [],
        required_user_input: null,
        payment_status: "not_required",
        monitoring_active: false,
        journey_complete: false,
        second_payment_required: false,
        retry_safe: true,
        completed_step: "SERVICE_SELECTED",
        next_action: "CONTINUE_PURCHASE_SETUP",
        next_service_id: FREE_SERVICE_ID,
        service: free,
        message:
          "Nobu Purchase Setup (33561) is free. It does not sell a Monitoring Pass and does not activate monitoring by first contact alone. Continue free purchase setup, pass handoff, one-time checks, or monitor management on this endpoint. If the user needs a Monitoring Pass, select service 35958 explicitly.",
        guidance:
          "Stay on free service 33561. Do not request payment here. Do not invent product details. If the user only wants a pass, switch to service 35958 after explicit confirmation.",
        documentation: NOBU_DOCUMENTATION_URL,
      },
    };
  }

  if (serviceId === PAID_SERVICE_ID) {
    return {
      http_status: 200,
      body: {
        status: "SERVICE_SELECTED",
        agent_id: NOBU_AGENT_ID,
        agent_name: NOBU_AGENT_NAME,
        selected_service_id: PAID_SERVICE_ID,
        selected_service_name: PAID_SERVICE_NAME,
        available_services,
        service_confirmation_required: true,
        input_required: false,
        required_fields: [],
        fields: [],
        requiredArgs: [],
        required_user_input: null,
        product_details_required_before_payment: false,
        email_required_before_payment: false,
        alert_threshold_required: false,
        wallet_address_required_as_service_input: false,
        payment_status: "required",
        monitoring_active: false,
        journey_complete: false,
        second_payment_required: false,
        retry_safe: true,
        completed_step: "SERVICE_SELECTED",
        next_action: "CALL_PAID_MONITORING_PASS_ENDPOINT",
        next_service_id: PAID_SERVICE_ID,
        service: paid,
        service_description: paid.description,
        deliverable: { type: "monitoring_pass", quantity: 1 },
        paid_endpoint: paid.endpoint,
        message: paid.description,
        guidance:
          "Call the paid Monitoring Pass endpoint only after the user confirms service 35958. No product details, email, wallet address, or alert threshold are service inputs before payment. Payment alone does not activate monitoring; continue on free service 33561 after the pass is issued. Do not inspect payment balance before this service is selected.",
        documentation: NOBU_DOCUMENTATION_URL,
      },
    };
  }

  return {
    http_status: 400,
    body: {
      ...buildServiceSelectionRequired(env),
      error: "unknown_service_id",
      message: `Unknown service_id ${serviceId}. Nobu offers only 33561 (free Purchase Setup) and 35958 (paid Monitoring Pass).`,
    },
  };
}

/**
 * Machine fields shared by the unpaid paid-service 402 JSON body.
 * Challenge header and body must agree; description comes from the catalogue.
 */
export function buildPaidPrePaymentMachineFields(
  env: EnvRecord = process.env,
): Record<string, unknown> {
  const free = buildFreeCatalogueService(env);
  const paid = buildPaidCatalogueService(env);
  return {
    selected_service_id: PAID_SERVICE_ID,
    selected_service_name: PAID_SERVICE_NAME,
    available_services: [free, paid],
    service_confirmation_required: true,
    service_description: paid.description,
    deliverable: { type: "monitoring_pass", quantity: 1 },
    input_required: false,
    required_fields: [],
    fields: [],
    requiredArgs: [],
    required_user_input: null,
    product_details_required_before_payment: false,
    email_required_before_payment: false,
    alert_threshold_required: false,
    wallet_address_required_as_service_input: false,
    payment_status: "required",
    monitoring_active: false,
    journey_complete: false,
    second_payment_required: false,
    next_service_id: FREE_SERVICE_ID,
    next_action_after_payment: "CONTINUE_PURCHASE_SETUP",
    agent_id: NOBU_AGENT_ID,
    agent_name: NOBU_AGENT_NAME,
  };
}
