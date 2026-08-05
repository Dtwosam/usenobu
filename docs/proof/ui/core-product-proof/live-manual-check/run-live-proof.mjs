/**
 * Sprint A.1 — one bounded live manual check on production.
 * Fixture create/confirm still demo; Check price now must hit LIVE SerpApi.
 * Does not require a price drop. Fail-closed outcomes PASS.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve(
  "docs/proof/ui/core-product-proof/live-manual-check",
);
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  sprint: "A.1",
  real_provider_calls_intended: 1,
  note: "Create/confirm may still use demo match fixtures; manual check path must be LIVE.",
  checks: {},
  live_check: null,
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

// Health
const healthRes = await fetch(`${base}/health`);
const health = await healthRes.json();
out.checks.health = { status: healthRes.status, body: health };

// Agent frozen
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
  body: (await agentRes.text()).slice(0, 200),
  ok: agentRes.status === 404,
};

if (!health.serpapi_configured) {
  out.verdict = "NOBU_REVIEW_SAFE_A_1_BLOCKED";
  out.blocker = "SERPAPI not configured on production";
  fs.writeFileSync(
    path.join(proofDir, "live-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
await openManual(page);

const purchaseDate = new Date(Date.now() - 2 * 864e5)
  .toISOString()
  .slice(0, 10);
await page
  .getByTestId("input-url")
  .fill("https://www.target.com/p/example-widget/-/A-87654321");
await page.getByTestId("input-price").fill("39.99");
await page.getByTestId("input-date").fill(purchaseDate);
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-model").fill("WDG-100");
await page.getByTestId("input-tcin").fill("87654321");
await page.getByTestId("input-title").fill("Example Widget Blue");
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
const fixtureBanner = await page.getByTestId("fixture-banner").count();
out.checks.dashboard_before_check = {
  url: page.url(),
  fixture_banner_visible: fixtureBanner > 0,
  status: (await page.getByTestId("status-code").innerText().catch(() => "")).trim(),
  check_visible: await page.getByTestId("run-check").isVisible(),
};

// Exactly one live manual check
const started = Date.now();
await Promise.all([
  page.waitForURL(/checked=1|outcome=|\/alerts\//, { timeout: 90_000 }),
  page.getByTestId("run-check").click(),
]);
const elapsed_ms = Date.now() - started;

const finalUrl = page.url();
const u = new URL(finalUrl);
const outcome = u.searchParams.get("outcome");
const dataSource = u.searchParams.get("data_source");
const error = u.searchParams.get("error");

out.live_check = {
  query_timestamp: new Date(started).toISOString(),
  elapsed_ms,
  final_url: finalUrl,
  outcome,
  data_source: dataSource,
  error,
  on_alert_page: finalUrl.includes("/alerts/"),
};

// Production must not report FIXTURE for this check
out.checks.not_silent_fixture =
  dataSource === "LIVE" ||
  (dataSource !== "FIXTURE" && !error?.includes("fixture"));

await page.screenshot({
  path: path.join(proofDir, "after-live-check.png"),
  fullPage: true,
});

// Open details if on dashboard
if (!out.live_check.on_alert_page) {
  const details = page.getByText("View details", { exact: true });
  if (await details.isVisible().catch(() => false)) {
    await details.click();
    const provider = await page
      .getByTestId("provider-outcome")
      .innerText()
      .catch(() => null);
    const priceSource = await page
      .getByTestId("price-data-source")
      .innerText()
      .catch(() => null);
    out.live_check.provider_outcome_ui = provider;
    out.live_check.price_data_source_ui = priceSource;
    out.live_check.completed_checks = await page
      .getByTestId("completed-check-count")
      .innerText()
      .catch(() => null);
  }
} else {
  await page.screenshot({
    path: path.join(proofDir, "live-alert-page.png"),
    fullPage: true,
  });
  // Back to dashboard for details
  const back = page.getByTestId("back-dashboard");
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.getByTestId("monitoring-proof").waitFor({ state: "visible" });
  }
}

// Fixture label must not claim live results are fixtures when data_source=LIVE
if (dataSource === "LIVE") {
  const body = await page.locator("body").innerText();
  out.checks.live_not_labelled_as_fixture = !/DEMO FIXTURE DATA/i.test(body);
}

out.checks.serpapi_configured = health.serpapi_configured === true;
out.checks.no_api_key_in_ui = !(await page.content()).match(
  /serpapi[_-]?api[_-]?key\s*[:=]/i,
);

const pass =
  out.checks.health.status === 200 &&
  out.checks.agent.ok &&
  out.checks.serpapi_configured &&
  out.checks.dashboard_before_check.check_visible &&
  out.live_check &&
  out.checks.not_silent_fixture &&
  // Truthful outcome codes (drop not required)
  (out.live_check.outcome || out.live_check.error) &&
  out.live_check.data_source === "LIVE";

out.verdict = pass
  ? "NOBU_REVIEW_SAFE_A_1_PASS"
  : "NOBU_REVIEW_SAFE_A_1_BLOCKED";
out.searches_consumed_note =
  "Budget ledger is cookie-scoped on Vercel; UI completed-check count reflects persisted runs when present.";

fs.writeFileSync(
  path.join(proofDir, "live-proof.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!pass) process.exit(1);
