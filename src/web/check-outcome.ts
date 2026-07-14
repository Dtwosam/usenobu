/**
 * Short, plain-English outcomes for manual price checks.
 * Never surface raw enums as primary user copy.
 */

export type CheckOutcomeCode =
  | "no_lower"
  | "price_drop"
  | "ambiguous"
  | "no_match"
  | "no_reliable_price"
  | "provider_unavailable"
  | "window_ended"
  | "cooldown"
  | "budget"
  | "not_confirmed"
  | "not_found"
  | "busy"
  | "unauthorized"
  | "checked";

export function checkOutcomeMessage(code: CheckOutcomeCode): string {
  switch (code) {
    case "no_lower":
      return "No lower price found.";
    case "price_drop":
      return "Possible price difference found.";
    case "ambiguous":
      return "More than one possible match was found, so Nobu made no price decision.";
    case "no_match":
      return "Nobu could not confirm the exact product.";
    case "no_reliable_price":
      return "No reliable Target price is available.";
    case "provider_unavailable":
      return "The price source is temporarily unavailable.";
    case "window_ended":
      return "This monitoring window has ended.";
    case "cooldown":
      return "Please wait before checking again.";
    case "budget":
      return "The price source is temporarily unavailable.";
    case "not_confirmed":
      return "Confirm the exact product before checking.";
    case "not_found":
      return "Purchase not found.";
    case "busy":
      return "Please wait before checking again.";
    case "unauthorized":
      return "You can’t check this purchase.";
    case "checked":
      return "No lower price found.";
    default:
      return "Price check finished.";
  }
}

/** Map monitor result + notes to a short outcome code. */
export function outcomeFromMonitorResult(args: {
  skip_reason?: string | null;
  match_ok?: boolean;
  match_reasons?: string[];
  alert_created?: boolean;
  notes?: string[];
  provider_status?: string;
  potential_recovery?: number;
}): CheckOutcomeCode {
  const skip = args.skip_reason ?? null;
  if (skip === "window_expired") return "window_ended";
  if (skip === "budget_exhausted") return "budget";
  if (skip === "missing_locked_fingerprint") return "not_confirmed";
  if (skip === "cooldown_active") return "cooldown";
  if (skip === "check_in_progress") return "busy";

  const notes = args.notes ?? [];
  const reasons = (args.match_reasons ?? []).join(" ").toLowerCase();
  const status = String(args.provider_status ?? "").toUpperCase();

  if (
    status.includes("RATE") ||
    status.includes("ERROR") ||
    status.includes("UNAVAILABLE")
  ) {
    return "provider_unavailable";
  }

  if (args.alert_created || notes.some((n) => n.includes("alert_created"))) {
    return "price_drop";
  }

  if (
    reasons.includes("ambiguous") ||
    notes.some((n) => n.includes("ambiguous"))
  ) {
    return "ambiguous";
  }

  if (
    reasons.includes("seller") ||
    reasons.includes("non_target") ||
    reasons.includes("target_plus")
  ) {
    return "no_match";
  }

  if (
    reasons.includes("model") ||
    reasons.includes("fingerprint") ||
    reasons.includes("no_locked") ||
    reasons.includes("title")
  ) {
    return "no_match";
  }

  if (!args.match_ok) {
    if (status.includes("NO_TARGET") || status.includes("NO_PRICE")) {
      return "no_reliable_price";
    }
    return "no_match";
  }

  if (
    args.potential_recovery != null &&
    args.potential_recovery <= 0 &&
    notes.some((n) => n.includes("alert_suppressed"))
  ) {
    return "no_lower";
  }

  return "no_lower";
}

export function explainMatchReasons(reasons: string[]): string {
  const joined = reasons.join(" ").toLowerCase();
  if (joined.includes("ambiguous")) {
    return "More than one possible match was found, so Nobu made no price decision.";
  }
  if (joined.includes("seller") || joined.includes("non_target")) {
    return "Nobu rejected this offer because the seller was not confirmed as Target.";
  }
  if (
    joined.includes("model") ||
    joined.includes("fingerprint") ||
    joined.includes("no_locked") ||
    joined.includes("title")
  ) {
    return "Nobu rejected this price because it could not confirm the exact product.";
  }
  if (joined.includes("window")) {
    return "This monitoring window has ended.";
  }
  return "No lower price found.";
}

/** Prefer short decision line for the latest check result banner. */
export function decisionBannerMessage(args: {
  outcome?: string | null;
  match_result?: string | null;
  notes?: string | null;
  alert_created?: boolean;
}): string {
  const code = (args.outcome ?? "") as CheckOutcomeCode;
  if (code && code !== "checked") {
    return checkOutcomeMessage(code);
  }
  const notes = String(args.notes ?? "").toLowerCase();
  const match = String(args.match_result ?? "").toLowerCase();
  if (args.alert_created || notes.includes("alert_created")) {
    return "Possible price difference found.";
  }
  if (match.includes("ambiguous") || notes.includes("ambiguous")) {
    return "More than one possible match was found, so Nobu made no price decision.";
  }
  if (match.includes("seller") || match.includes("non_target")) {
    return "Nobu rejected this offer because the seller was not confirmed as Target.";
  }
  if (
    match.includes("model") ||
    match.includes("fingerprint") ||
    match.includes("title") ||
    match.includes("no_match")
  ) {
    return "Nobu rejected this price because it could not confirm the exact product.";
  }
  if (notes.includes("provider") || notes.includes("unavailable")) {
    return "The price source is temporarily unavailable. No price decision was made.";
  }
  return "No lower price found.";
}

export function alertActionLabel(run: Record<string, unknown>): string {
  if (run.alert_id) return "Alert created";
  const notes = String(run.notes ?? "").toLowerCase();
  if (notes.includes("alert_suppressed") || notes.includes("no_lower")) {
    return "Alert suppressed";
  }
  if (String(run.outcome) === "skipped") return "No alert (skipped)";
  return "No alert";
}

export function suppressionReasonLabel(run: Record<string, unknown>): string | null {
  const notes = String(run.notes ?? "");
  if (notes.includes("alert_suppressed")) {
    if (notes.includes("unchanged") || notes.includes("not_lower")) {
      return "Observed price was not lower than purchase price.";
    }
    if (notes.includes("duplicate") || notes.includes("idempotent")) {
      return "Same lower observation already alerted.";
    }
    return "Alert suppressed for this observation.";
  }
  if (run.skip_reason) {
    const skip = String(run.skip_reason);
    if (skip === "budget_exhausted") return "Monthly search budget exhausted.";
    if (skip === "window_expired") return "Monitoring window ended.";
    if (skip === "missing_locked_fingerprint") return "No locked product fingerprint.";
    return skip.replace(/_/g, " ");
  }
  return null;
}
