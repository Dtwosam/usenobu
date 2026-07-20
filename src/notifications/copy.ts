/** Approved product copy — Lane 7.3B (never guarantee refunds). */

export const ALERT_PREFERENCE_LABEL = "Email me about possible price drops";

export const ALERT_PREFERENCE_SUPPORT =
  "Alerts will be sent to your verified Nobu account email.";

export function alertPreferenceMaskedSupport(maskedEmail: string): string {
  return `Alerts will be sent to ${maskedEmail}`;
}

export const GUEST_ALERT_CTA = "Sign in to receive automatic email alerts";
export const GUEST_ALERT_ACTION = "Sign in";

export const WATCHING_HEADING = "Nobu is watching this purchase";

export const WATCHING_BODY =
  "Nobu checks this purchase on a controlled schedule and will email you if a possible price drop appears while it is still within its monitoring window.";

/** Hero / marketing line */
export const NOBU_WATCH_TAGLINE =
  "Add your purchase once. Nobu keeps watching the price and alerts you by email when you may be able to request the difference.";

export const PRICE_DROP_EMAIL_SUBJECT = "Nobu found a possible price drop";

export const PRICE_DROP_EMAIL_OPENING =
  "Nobu noticed that the latest observed Target price may be lower than the price you paid.";

export const PRICE_DROP_EMAIL_DISCLOSURE =
  "Target must verify the current price and makes the final decision. This is a possible price-adjustment opportunity, not a guaranteed refund.";

export const PRICE_DROP_EMAIL_PRIMARY_CTA = "Review opportunity";

export const DISABLE_ALERTS_LABEL = "Turn off email alerts for this purchase";
