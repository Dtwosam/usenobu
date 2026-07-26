/** Provider-controlled, machine-readable Nobu journey state. */
export type JourneyFields = {
  completed_step: string;
  monitoring_active: boolean;
  journey_complete: boolean;
  next_action: string;
  required_user_input: Record<string, unknown> | null;
  guidance: string;
};

type Result = { http_status: number; body: Record<string, unknown> };
const req = (action: string, required_fields: string[], description: string) =>
  ({ action, required_fields, description });
const step = (
  completed_step: string,
  next_action: string,
  required_user_input: Record<string, unknown> | null,
  guidance: string,
  monitoring_active = false,
): JourneyFields => ({
  completed_step,
  monitoring_active,
  journey_complete: monitoring_active,
  next_action,
  required_user_input,
  guidance,
});

function journey(action: string, result: Result): JourneyFields {
  const status = String(result.body.status ?? "");
  const ok = result.http_status === 200;

  if (action === "UNDERSTAND_PURCHASE") return ok
    ? step("PURCHASE_DETAILS_EXTRACTED", "DISCOVER_PRODUCT", {
        ...req("DISCOVER_PRODUCT", ["purchase"], "User-reviewed structured purchase details."),
        purchase_fields: ["purchase_price", "purchase_date", "purchase_channel", "country", "at least one product clue"],
      }, "Nobu extracted details only. Ask the user to confirm them, then send DISCOVER_PRODUCT. Monitoring is not active.")
    : step("NOBU_INTRODUCED", "UNDERSTAND_PURCHASE", req("UNDERSTAND_PURCHASE", ["purchase_text"], "A description of the recent Target online purchase."), "Purchase Setup is free and never uses x402. Ask for the purchase description and retry.");

  if (action === "DISCOVER_PRODUCT") return ok
    ? step("PRODUCT_CANDIDATES_FOUND", "CONFIRM_PRODUCT", req("CONFIRM_PRODUCT", ["discovery_session_id", "candidate_id"], "The exact Target product selected by the user."), "Show the candidates and require the user to select the exact product. Never choose for them.")
    : step("PURCHASE_DETAILS_NOT_ACCEPTED", "DISCOVER_PRODUCT", req("DISCOVER_PRODUCT", ["purchase"], "Corrected details with price, date and a product clue."), "Correct the purchase details with the user and retry. Monitoring is not active.");

  if (action === "CONFIRM_PRODUCT") return ok
    ? step("PRODUCT_CONFIRMED", "BEGIN_EMAIL_VERIFICATION", req("BEGIN_EMAIL_VERIFICATION", ["email"], "The email the user controls for consented alerts."), "The exact product is confirmed. Begin email verification. Monitoring is not active.")
    : step("PRODUCT_NOT_CONFIRMED", "DISCOVER_PRODUCT", req("DISCOVER_PRODUCT", ["purchase"], "Details sufficient for a fresh candidate set."), "Return to discovery and require the user to choose an exact candidate.");

  if (action === "BEGIN_EMAIL_VERIFICATION") return ok
    ? step("EMAIL_CODE_SENT", "VERIFY_EMAIL_CODE", req("VERIFY_EMAIL_CODE", ["connection_id", "code"], "The six-digit code received by email."), "Ask for the emailed code, then verify it. Do not display or log credentials.")
    : step("EMAIL_VERIFICATION_NOT_STARTED", "BEGIN_EMAIL_VERIFICATION", req("BEGIN_EMAIL_VERIFICATION", ["email"], "A valid email controlled by the user."), "Correct the address or wait for the stated retry period.");

  if (action === "VERIFY_EMAIL_CODE") {
    const expired = status === "CODE_EXPIRED";
    return ok && status === "EMAIL_VERIFIED"
      ? step("EMAIL_VERIFIED", "PREFLIGHT_MONITORING", req("PREFLIGHT_MONITORING", ["verified connection credentials", "discovery_session_id", "monitoring_consent", "email_alert_consent"], "Ask separately for both explicit consents; both must be true."), "Email is verified. Ask for both consents, then run preflight. Monitoring is not active.")
      : step("EMAIL_NOT_VERIFIED", expired ? "BEGIN_EMAIL_VERIFICATION" : "VERIFY_EMAIL_CODE", req(expired ? "BEGIN_EMAIL_VERIFICATION" : "VERIFY_EMAIL_CODE", expired ? ["email"] : ["connection_id", "code"], expired ? "A fresh verification request." : "The current email code."), "Email is not verified, so monitoring cannot continue.");
  }

  if (action === "PREFLIGHT_MONITORING") return ok && status === "MONITORING_PAYMENT_READY"
    ? step("ELIGIBILITY_AND_CONSENT_VERIFIED", "REDEEM_MONITORING_PASS", req("REDEEM_MONITORING_PASS", ["monitoring_pass_id", "quote_id", "verified connection credentials"], "The pass id from service 35958 and this current quote."), "The purchase is confirmed, eligible and consented. Redeem the pass. Monitoring is still not active.")
    : step("PREFLIGHT_NOT_COMPLETED", "PREFLIGHT_MONITORING", req("PREFLIGHT_MONITORING", ["verified connection credentials", "confirmed discovery_session_id", "monitoring_consent", "email_alert_consent"], "A current confirmed product and both explicit consents."), "Resolve the returned status before retrying. Monitoring is not active.");

  if (action === "REDEEM_MONITORING_PASS") {
    const active = ok && (status === "MONITORING_STARTED" || status === "ALREADY_ACTIVE");
    if (active) return step("MONITORING_PASS_REDEEMED", "CHECK_MONITORING_STATUS", null, "Monitoring is active. A lower price, alert or adjustment is never guaranteed.", true);
    const pending = status === "ACTIVATION_PENDING";
    return step(pending ? "MONITORING_ACTIVATION_PENDING" : "MONITORING_PASS_NOT_REDEEMED", pending ? "CHECK_MONITORING_STATUS" : "PREFLIGHT_MONITORING", pending ? null : req("PREFLIGHT_MONITORING", ["verified connection credentials", "confirmed discovery_session_id", "monitoring_consent", "email_alert_consent"], "A fresh quote before retrying redemption with the same pass id."), pending ? "Activation is completing. Do not pay or redeem again; check status." : "The pass was not redeemed. Complete a fresh preflight, then retry.");
  }

  if (action === "CHECK_MONITORING_STATUS") {
    const active = ok && status === "MONITORING_ACTIVE";
    return step("MONITORING_STATUS_CHECKED", active ? "WAIT_FOR_NOBU_ALERTS" : "CHECK_MONITORING_STATUS", null, active ? "Monitoring remains active. Target makes the final adjustment decision." : "Monitoring is not active according to this response.", active);
  }

  const active = action === "LIST_ACTIVE_MONITORS" && ok && Number(result.body.count ?? 0) > 0;
  return step(ok ? `${action}_COMPLETED` : `${action}_NOT_COMPLETED`, active ? "CHECK_MONITORING_STATUS" : action, null, ok ? "The requested Nobu management step completed." : "Correct the request and retry without exposing credentials.", active);
}

export function addJourneyFields(raw: unknown, result: Result): Result {
  const action = raw && typeof raw === "object" && !Array.isArray(raw) && typeof (raw as { action?: unknown }).action === "string"
    ? String((raw as { action: string }).action) : "";
  if (!action) return result;
  const j = journey(action, result);
  const body: Record<string, unknown> = { ...result.body, ...j };
  if (action === "REDEEM_MONITORING_PASS" && j.monitoring_active && typeof result.body.status === "string") {
    body.activation_result = result.body.status;
    body.status = "MONITORING_ACTIVE";
  }
  return { ...result, body };
}
