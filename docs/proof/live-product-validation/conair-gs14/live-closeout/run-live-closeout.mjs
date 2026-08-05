/**
 * A.3 — one bounded production Check price now for Conair GS14.
 * Enrollment may use fixture candidates; check path must be LIVE SerpApi.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve(
  "docs/proof/live-product-validation/conair-gs14/live-closeout",
);
fs.mkdirSync(proofDir, { recursive: true });

const CONAIR = {
  title: "Conair ExtremeSteam Handheld Garment Steamer",
  model: "GS14",
  tcin: "87470797",
  upc: "074108469755",
  url: "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
  price: "39.99",
};

const out = {
  at: new Date().toISOString(),
  base,
  sprint: "A.3",
  product: CONAIR.title,
  checks: {},
  live_check: null,
  policy: {
    source:
      "https://www.target.com/help/articles/policies-guidelines/price-match-guarantee",
    verified_at_intended: "2026-07-14T20:00:00.000Z",
    changes_found:
      "None material vs locked contract: 14-day window; identical item/brand/size/weight/color/quantity/model; Target verifies; AK/HI and Target Plus exclusions; Guest Services 1-800-591-3869; screenshots not accepted as final proof.",
  },
};

async function openManual(page) {
  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    const e = await btn.getAttribute("aria-expanded");
    if (e !== "true") await btn.click();
  }
  await page
    .getByTestId("purchase-form")
    .waitFor({ state: "visible", timeout: 20_000 });
}

// Health + agent
const healthRes = await fetch(`${base}/health`);
out.checks.health = { status: healthRes.status, body: await healthRes.json() };

const agentRes = await fetch(`${base}/v1/agent`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "CHECK_MONITORING_STATUS",
    purchase_id: "does-not-exist",
  }),
});
out.checks.agent = {
  status: agentRes.status,
  ok: agentRes.status === 404,
  body: (await agentRes.text()).slice(0, 200),
};

// A2MCP one-shot must not be POLICY_STALE after freshness refresh
const a2mcpBody = {
  target_product_url: CONAIR.url,
  purchase_price: 39.99,
  currency: "USD",
  purchase_date: new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10),
  country: "US",
  region: "TX",
  purchase_channel: "target_online",
  model_number: CONAIR.model,
  target_item_id: CONAIR.tcin,
  upc_or_gtin: CONAIR.upc,
};
const a2mcpRes = await fetch(`${base}/v1/target-price-check`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(a2mcpBody),
});
const a2mcpJson = await a2mcpRes.json();
out.checks.a2mcp_one_shot = {
  status: a2mcpRes.status,
  body_status: a2mcpJson.status,
  not_policy_stale: a2mcpJson.status !== "POLICY_STALE",
  data_source_type: a2mcpJson.price_source_type,
  provider: a2mcpJson.provider,
  // Redact long disclaimer
  has_disclaimer: Boolean(a2mcpJson.disclaimer),
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await openManual(page);

const purchaseDate = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
await page.getByTestId("input-url").fill(CONAIR.url);
await page.getByTestId("input-price").fill(CONAIR.price);
await page.getByTestId("input-date").fill(purchaseDate);
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-model").fill(CONAIR.model);
await page.getByTestId("input-tcin").fill(CONAIR.tcin);
await page.getByTestId("input-upc").fill(CONAIR.upc);
await page.getByTestId("input-title").fill(CONAIR.title);
if (await page.getByTestId("input-scenario").count()) {
  await page.getByTestId("input-scenario").selectOption("exact_match");
}

await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);
await Promise.all([
  page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 60_000 }),
  page.getByTestId("confirm-candidate").click(),
]);
await page.getByTestId("monitoring-proof").waitFor({ state: "visible" });

// Exactly one Check price now
const started = Date.now();
await Promise.all([
  page.waitForURL(/checked=1|outcome=|\/alerts\//, { timeout: 120_000 }),
  page.getByTestId("run-check").click(),
]);
const elapsed_ms = Date.now() - started;
const finalUrl = page.url();
const u = new URL(finalUrl);

out.live_check = {
  query_timestamp: new Date(started).toISOString(),
  elapsed_ms,
  final_url: finalUrl,
  outcome: u.searchParams.get("outcome"),
  data_source: u.searchParams.get("data_source"),
  error: u.searchParams.get("error"),
  on_alert: finalUrl.includes("/alerts/"),
};

await page.screenshot({
  path: path.join(proofDir, "after-live-check.png"),
  fullPage: true,
});

// Details when on dashboard
if (!out.live_check.on_alert) {
  const details = page.getByText("View details", { exact: true });
  if (await details.isVisible().catch(() => false)) {
    await details.click();
    out.live_check.provider_outcome = await page
      .getByTestId("provider-outcome")
      .innerText()
      .catch(() => null);
    out.live_check.price_data_source = await page
      .getByTestId("price-data-source")
      .innerText()
      .catch(() => null);
    out.live_check.completed_checks = await page
      .getByTestId("completed-check-count")
      .innerText()
      .catch(() => null);
    out.live_check.matching_decision = await page
      .getByTestId("matching-decision")
      .innerText()
      .catch(() => null);
  }
  const outcomeEl = page.getByTestId("check-outcome");
  if (await outcomeEl.count()) {
    out.live_check.outcome_message = (await outcomeEl.innerText()).trim();
  }
}

const body = await page.locator("body").innerText();
out.checks.no_api_key = !/serpapi[_-]?api[_-]?key\s*[:=]/i.test(body);
out.checks.not_fixture =
  out.live_check.data_source === "LIVE" ||
  (out.live_check.data_source !== "FIXTURE" &&
    !/DEMO FIXTURE DATA/i.test(body) &&
    out.checks.a2mcp_one_shot?.not_policy_stale);

const unacceptable =
  out.live_check.outcome === "window_ended" ||
  out.live_check.error === "POLICY_STALE" ||
  out.live_check.data_source === "FIXTURE" ||
  String(out.checks.a2mcp_one_shot?.body_status) === "POLICY_STALE";

// Acceptable: price_drop, no_lower, no_match, no_reliable_price, ambiguous (specific), provider only if not config
const acceptableOutcome = [
  "price_drop",
  "no_lower",
  "no_match",
  "no_reliable_price",
  "ambiguous",
].includes(out.live_check.outcome || "");

const pass =
  out.checks.health.status === 200 &&
  out.checks.agent.ok &&
  out.checks.a2mcp_one_shot.not_policy_stale &&
  out.live_check.data_source === "LIVE" &&
  !unacceptable &&
  acceptableOutcome &&
  out.checks.no_api_key;

out.verdict = pass
  ? "NOBU_REVIEW_SAFE_A_3_PASS"
  : "NOBU_REVIEW_SAFE_A_3_BLOCKED";
out.searches_consumed_note =
  "At most one manual check; completed_checks UI when available.";

fs.writeFileSync(
  path.join(proofDir, "live-closeout.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!pass) process.exit(1);
