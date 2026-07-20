/**
 * Redacted price-drop email smoke (test capture mode).
 * Does not print full email addresses or API keys.
 */
import {
  buildPriceDropEmailText,
  sendPriceDropEmail,
  clearCapturedPriceDropEmails,
  getCapturedPriceDropEmails,
} from "../src/notifications/email-send.ts";
import { maskEmail } from "../src/notifications/mask-email.ts";
import { PRICE_DROP_EMAIL_DISCLOSURE } from "../src/notifications/copy.ts";

process.env.NOBU_AUTH_TEST_MODE = "1";
clearCapturedPriceDropEmails();

const evidence = {
  purchase_id: "pur_smoke",
  product_title: "Smoke Test Widget",
  purchase_price: 29.99,
  observed_price: 19.99,
  potential_recovery: 10,
  currency: "USD",
  monitoring_deadline: "2026-07-20",
  observed_at: "2026-07-15T12:00:00.000Z",
  alert_id: "alert_smoke",
  opportunity_key: "opp_smoke",
  review_path: "/purchases/pur_smoke/alerts/alert_smoke",
};

const reviewUrl =
  "https://www.usenobu.xyz/purchases/pur_smoke/alerts/alert_smoke";
const disableAlertsUrl =
  "https://www.usenobu.xyz/purchases/pur_smoke?alerts=off";

const built = buildPriceDropEmailText({
  evidence,
  reviewUrl,
  disableAlertsUrl,
});

const send = await sendPriceDropEmail({
  emailNormalized: "smoke@example.com",
  evidence,
  reviewUrl,
  disableAlertsUrl,
  env: { ...process.env, NOBU_AUTH_TEST_MODE: "1" },
});

const cap = getCapturedPriceDropEmails()[0];

const out = {
  ok: send.ok,
  mode: send.ok ? send.mode : send.error,
  subject: built.subject,
  has_disclosure: built.text.includes(PRICE_DROP_EMAIL_DISCLOSURE),
  has_cta: built.text.includes("Review opportunity"),
  has_disable: built.text.includes("Turn off email alerts"),
  has_token_in_url: /token=/.test(built.text),
  has_raw_email_in_body: built.text
    .toLowerCase()
    .includes("smoke@example.com"),
  masked_ui: maskEmail("smoke@example.com"),
  capture_to_hash: cap?.toHash ?? null,
  capture_purchase_id: cap?.purchase_id ?? null,
};

console.log(JSON.stringify(out, null, 2));
if (!out.ok || out.has_token_in_url || out.has_raw_email_in_body) {
  process.exit(1);
}
