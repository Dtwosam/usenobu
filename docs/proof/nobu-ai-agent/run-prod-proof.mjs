/**
 * Lane 7.5E production proof script (no secrets).
 * Usage: node docs/proof/nobu-ai-agent/run-prod-proof.mjs
 */
const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";

async function main() {
  const out = { base, at: new Date().toISOString(), checks: {} };

  const health = await fetch(`${base}/health`).then((r) => r.json());
  out.checks.health = {
    ok: health.status === "ok" && health.service === "nobu-a2mcp",
    service: health.service,
  };

  const text =
    "I bought up and up acetaminophen from Target online yesterday for $9.99. https://www.target.com/p/acetaminophen/-/A-12345678";
  const uRes = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "UNDERSTAND_PURCHASE",
      purchase_text: text,
    }),
  });
  const u = await uRes.json();
  const uStr = JSON.stringify(u);
  out.checks.understand_purchase = {
    http_status: uRes.status,
    agent_state: u.agent_state,
    next_action: u.next_action,
    requires_user_action: u.requires_user_action,
    purchase_price: u.extracted_purchase?.purchase_price ?? null,
    product_url: u.extracted_purchase?.product_url ?? null,
    retailer: u.extracted_purchase?.retailer ?? null,
    missing_fields: u.missing_fields ?? [],
    uncertain_fields: u.uncertain_fields ?? [],
    provider: u.provider ?? null,
    raw_text_absent_from_response: !uStr.includes("I bought up and up"),
    secrets_absent: !/api[_-]?key|xai-/i.test(uStr),
    no_match_status:
      u.agent_state === "CONFIRMATION_REQUIRED" &&
      !["EXACT_MATCH_CANDIDATE", "MONITORING_ACTIVE", "PRICE_DROP_DETECTED"].includes(
        u.status,
      ),
  };

  const cRes = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CHECK_CONFIRMED_PURCHASE",
      target_product_url:
        "https://www.target.com/p/example-widget/-/A-87654321",
      purchase_price: 24.99,
      currency: "USD",
      purchase_date: "2026-07-05",
      country: "US",
      region: "TX",
      purchase_channel: "target_online",
    }),
  });
  const c = await cRes.json();
  out.checks.check_confirmed_purchase = {
    http_status: cRes.status,
    status: c.status ?? null,
    final_decision_by: c.final_decision_by ?? null,
    deterministic_keys_present: Boolean(c.policy_id && c.price_source_type),
  };

  const tRes = await fetch(`${base}/v1/target-price-check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_product_url:
        "https://www.target.com/p/example-widget/-/A-87654321",
      purchase_price: 24.99,
      currency: "USD",
      purchase_date: "2026-07-05",
      country: "US",
      region: "TX",
      purchase_channel: "target_online",
    }),
  });
  const t = await tRes.json();
  out.checks.target_price_check_compat = {
    http_status: tRes.status,
    status: t.status ?? null,
    same_family_as_agent_check:
      t.status === c.status || (t.status && c.status),
  };

  const home = await fetch(`${base}/`).then((r) => r.text());
  const add = await fetch(`${base}/purchases/new`).then((r) => r.text());
  out.checks.ui_copy = {
    home_eyebrow: home.includes("Your AI agent after checkout"),
    home_headline: home.includes("Bought it"),
    home_cta: home.includes("Ask Nobu to watch a purchase"),
    nl_heading: add.includes("Tell Nobu what you bought"),
    fill_ai: add.includes("Fill details with AI"),
    manual: add.includes("Enter details manually"),
    find_product: add.includes("Find my product"),
    trust: home.includes("Deterministic retailer rules"),
  };

  const pass =
    out.checks.health.ok &&
    out.checks.understand_purchase.http_status === 200 &&
    out.checks.understand_purchase.agent_state === "CONFIRMATION_REQUIRED" &&
    out.checks.understand_purchase.requires_user_action === true &&
    out.checks.understand_purchase.raw_text_absent_from_response &&
    out.checks.understand_purchase.secrets_absent &&
    out.checks.check_confirmed_purchase.http_status === 200 &&
    out.checks.target_price_check_compat.http_status === 200 &&
    Object.values(out.checks.ui_copy).every(Boolean);

  out.verdict = pass ? "NOBU_LANE_7_5E_PROD_PROOF_PASS" : "NOBU_LANE_7_5E_PROD_PROOF_BLOCKED";
  console.log(JSON.stringify(out, null, 2));
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
