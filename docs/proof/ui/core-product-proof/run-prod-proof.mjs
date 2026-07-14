/**
 * Production browser proof — Core Product Proof (Sprint A).
 * Fixture-labelled consumer path only; no live SerpApi search unless already gated.
 */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/ui/core-product-proof");
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  label: "FIXTURE_DEMO_CONSUMER_FLOW",
  real_provider_calls_consumed: 0,
  note: "Demo dashboard check uses fixture offers via runMonitoringPass; not a live SerpApi shopping call.",
  checks: {},
};

async function openManual(page) {
  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    const expanded = await btn.getAttribute("aria-expanded");
    if (expanded !== "true") await btn.click();
  }
  await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 20_000 });
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// Health
const healthRes = await fetch(`${base}/health`);
const health = await healthRes.json();
out.checks.health = { status: healthRes.status, body: health };

// Agent regression (frozen actions)
const agentRes = await fetch(`${base}/v1/agent`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "CHECK_MONITORING_STATUS",
    purchase_id: "does-not-exist",
  }),
});
const agentText = await agentRes.text();
out.checks.agent = {
  status: agentRes.status,
  body_snippet: agentText.slice(0, 300),
  expected_not_found: agentRes.status === 404,
};

// Full fixture flow
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByTestId("cta-add-purchase").click();
await page.waitForURL(/\/purchases\/new/, { timeout: 30_000 });
await openManual(page);

const today = new Date().toISOString().slice(0, 10);
await page.getByTestId("input-url").fill(
  "https://www.target.com/p/example-widget/-/A-87654321",
);
await page.getByTestId("input-price").fill("39.99");
await page.getByTestId("input-date").fill(today);
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-model").fill("WDG-100");
await page.getByTestId("input-tcin").fill("87654321");
await page.getByTestId("input-title").fill("Example Widget Blue");
const scenario = page.getByTestId("input-scenario");
if (await scenario.count()) {
  await scenario.selectOption("exact_match");
}

await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);

await Promise.all([
  page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 60_000 }),
  page.getByTestId("confirm-candidate").click(),
]);

await page.getByTestId("monitoring-proof").waitFor({ state: "visible", timeout: 30_000 });
await page.screenshot({
  path: path.join(proofDir, "desktop-monitoring-proof.png"),
  fullPage: true,
});

const support = (await page.getByTestId("proof-support").innerText()).trim();
const checkBtn = page.getByTestId("run-check");
const checkLabel = (await checkBtn.innerText()).trim();
const nextCheckCount = await page.getByTestId("next-check").count();

out.checks.default_ui = {
  support,
  check_label: checkLabel,
  next_check_invented: nextCheckCount > 0,
  monitoring_status: (await page.getByTestId("monitoring-status").innerText()).trim(),
  purchase_price: (await page.getByTestId("purchase-price").innerText()).trim(),
  days_remaining: (await page.getByTestId("days-remaining").innerText()).trim(),
};

// Open View details
await page.getByText("View details", { exact: true }).click();
await page.getByTestId("proof-details").waitFor({ state: "visible", timeout: 10_000 });
const completedBefore = (await page.getByTestId("completed-check-count").innerText()).trim();
out.checks.details_before_check = {
  completed_checks: completedBefore,
  last_attempted: (await page.getByTestId("last-attempted").innerText()).trim(),
};

const dashUrl = page.url().split("?")[0];

// Bounded check (fixture path)
await Promise.all([
  page.waitForURL(/\/(alerts\/|\?checked=1|\?error=)/, { timeout: 45_000 }),
  checkBtn.click(),
]);

const onAlert = page.url().includes("/alerts/");
out.checks.after_check = {
  url: page.url(),
  on_alert_page: onAlert,
};

if (onAlert) {
  const summary = page.getByTestId("alert-summary");
  const hasSummary = await summary
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  out.checks.after_check.alert_summary_visible = hasSummary;
  await page.screenshot({
    path: path.join(proofDir, "desktop-price-drop.png"),
    fullPage: true,
  });
  if (hasSummary) {
    await page.getByTestId("back-dashboard").click();
  } else {
    await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 60_000 });
  }
  await page.getByTestId("monitoring-proof").waitFor({ state: "visible", timeout: 20_000 });
}

// Cooldown: second click should not create another successful check immediately
const checkAgain = page.getByTestId("run-check");
const checkVisible = await checkAgain.isVisible().catch(() => false);
out.checks.cooldown_button = {
  visible_after_check: checkVisible,
  note: checkVisible
    ? "Button still shown; server enforces 30s cooldown if clicked"
    : "Button hidden (cooldown/budget/window gate on canOfferManualCheck)",
};

if (checkVisible) {
  await Promise.all([
    page.waitForURL(/outcome=cooldown|error=cooldown|checked=1|alerts\//, {
      timeout: 30_000,
    }).catch(() => null),
    checkAgain.click(),
  ]);
  out.checks.second_click_url = page.url();
}

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByTestId("monitoring-proof").waitFor({ state: "visible", timeout: 20_000 });
const overflow = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
}));
out.checks.mobile_390 = {
  ...overflow,
  ok: overflow.sw <= overflow.cw + 1,
};
await page.screenshot({
  path: path.join(proofDir, "mobile-monitoring-proof.png"),
  fullPage: true,
});

await page.setViewportSize({ width: 320, height: 720 });
await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 60_000 });
const overflow320 = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
}));
out.checks.mobile_320 = {
  ...overflow320,
  ok: overflow320.sw <= overflow320.cw + 1,
};
await page.screenshot({
  path: path.join(proofDir, "mobile-320-monitoring-proof.png"),
  fullPage: true,
});

// Axe on dashboard
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(dashUrl, { waitUntil: "networkidle", timeout: 60_000 });
const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
const blocking = axe.violations.filter(
  (v) => v.impact === "critical" || v.impact === "serious",
);
out.checks.a11y = {
  blocking: blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
  pass: blocking.length === 0,
};
fs.writeFileSync(
  path.join(proofDir, "axe-monitoring-proof.json"),
  JSON.stringify(
    {
      route: "purchase-dashboard",
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
      })),
    },
    null,
    2,
  ),
);

// Minimal-copy heuristics on default panel
const bodyText = await page.locator("[data-testid=monitoring-proof]").innerText();
out.checks.minimal_copy = {
  has_check_price_now: /Check price now/i.test(bodyText),
  has_view_details: /View details/i.test(bodyText),
  no_next_check_invented: !/Next scheduled check/i.test(bodyText) || nextCheckCount === 0,
  support_sentence_ok: support.length < 120,
};

const pass =
  out.checks.health.status === 200 &&
  out.checks.agent.expected_not_found &&
  out.checks.default_ui.check_label.includes("Check price now") &&
  !out.checks.default_ui.next_check_invented &&
  out.checks.after_check.on_alert_page &&
  out.checks.after_check.alert_summary_visible === true &&
  out.checks.mobile_390.ok &&
  out.checks.mobile_320.ok &&
  out.checks.a11y.pass &&
  out.checks.minimal_copy.has_check_price_now;

out.verdict = pass ? "NOBU_REVIEW_SAFE_A_PASS" : "NOBU_REVIEW_SAFE_A_BLOCKED";
fs.writeFileSync(path.join(proofDir, "prod-proof.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!pass) process.exit(1);
