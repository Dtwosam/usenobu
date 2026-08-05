/**
 * Lane 8R.3 — presentation logic for POST /v1/agent/start-monitoring.
 *
 * Root cause: OKX rejected ASP #5541 because actual service-call results did
 * not match the registered service description. Reproduction against
 * production showed the paid endpoint returning bare
 * `{"error":"invalid_input"}` / `{"status":"ACTION_NOT_AUTHORIZED"}` with no
 * guidance for the most likely first reviewer call — calling the paid
 * endpoint before completing the free setup flow, since a fresh caller
 * cannot have a valid quote_id/connection_id/connection_token yet. This
 * module adds machine-readable guidance to those two failure shapes only;
 * it changes no auth/payment/matching gate (see start-monitoring-service.ts).
 */
import type { StartMonitoringResult } from "./start-monitoring-service.js";

export const NOBU_AGENT_DOCS_URL = "https://www.usenobu.xyz/okx";

export const START_MONITORING_NEXT_ACTION =
  "Complete the free /v1/agent setup flow first (BEGIN_EMAIL_VERIFICATION, VERIFY_EMAIL_CODE, DISCOVER_PRODUCT, CONFIRM_PRODUCT, then PREFLIGHT_MONITORING) to obtain a matching quote_id, connection_id, and connection_token, then retry this request with those exact values.";

/**
 * quote_id/connection_id/connection_token must all come from a completed
 * free-flow PREFLIGHT_MONITORING response and must not be expired or
 * already used — the same reason-agnostic wording for both failure
 * statuses below, so the response never reveals which specific check
 * failed (quote ownership/expiry/price must stay indistinguishable from an
 * unknown quote or connection).
 */
export function startMonitoringInvalidInputBody(): Record<string, unknown> {
  return {
    error: "invalid_input",
    agent_state: "MONITORING_ACTIVATION",
    message:
      "This endpoint accepts only quote_id, connection_id, and connection_token (all non-empty strings, no other fields).",
    required_fields: ["quote_id", "connection_id", "connection_token"],
    next_action: START_MONITORING_NEXT_ACTION,
    documentation: NOBU_AGENT_DOCS_URL,
  };
}

export function startMonitoringResponseBody(
  result: StartMonitoringResult,
): Record<string, unknown> {
  const base = { agent_state: "MONITORING_ACTIVATION", status: result.status };
  if (result.ok && result.status === "PAYMENT_SETTLEMENT_PENDING") {
    return {
      ...base,
      note: result.note,
    };
  }
  if (result.ok && "monitoring_deadline" in result) {
    return {
      ...base,
      monitor_id: result.monitor_id,
      monitoring_deadline: result.monitoring_deadline,
    };
  }
  if (result.ok && "monitor_id" in result) {
    return { ...base, monitor_id: result.monitor_id };
  }
  // ACTION_NOT_AUTHORIZED / CONNECTION_EXPIRED: same reason-agnostic
  // guidance either way (never reveal which specific check failed).
  if (!result.ok && (result.status === "ACTION_NOT_AUTHORIZED" || result.status === "CONNECTION_EXPIRED")) {
    return {
      ...base,
      message:
        "quote_id, connection_id, and connection_token must all come from a completed free-flow PREFLIGHT_MONITORING response and must not be expired or already used.",
      next_action: START_MONITORING_NEXT_ACTION,
      documentation: NOBU_AGENT_DOCS_URL,
    };
  }
  return base;
}
