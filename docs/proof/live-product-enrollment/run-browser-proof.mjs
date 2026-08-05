/**
 * Bounded production browser proof: AI intake → Find product → Confirm → Check price.
 * One discovery + one manual check budget. Writes proof JSON + screenshots.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve("docs/proof/live-product-enrollment");
fs.mkdirSync(proofDir, { recursive: true });

const TEXT =
  "For testing, I bought an Apple AirTag from Target.com today for $35. The TCIN is 54191097, and the product link is https://www.target.com/p/apple-airtag/-/A-54191097.";

const out = {
  at: new Date().toISOString(),
  base,
  steps: {},
  verdict: null,
  provider_calls_note:
    "At most one live discovery (Find my product) + one Check price now",
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

// Health + agent freeze
{
  const h = await fetch(`${base}/health`);
  out.steps.health = { status: h.status, body: await h.json() };
  const a = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CHECK_MONITORING_STATUS",
      purchase_id: "pur_does_not_exist",
    }),
  });
  out.steps.agent = {
    status: a.status,
    body: (await a.text()).slice(0, 160),
    frozen: a.status === 404,
  };
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

try {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  // Prefer AI path when available
  const aiBox = page.getByTestId("ai-purchase-text");
  if (await aiBox.isVisible().catch(() => false)) {
    await aiBox.fill(TEXT);
    const extract = page.getByTestId("ai-extract-submit");
    if (await extract.isVisible().catch(() => false)) {
      await extract.click();
      await page.waitForTimeout(3000);
    }
  }

  await openManual(page);

  // Force exact AirTag identity (overwrite AI placeholders like "Example Widget")
  const today = new Date().toISOString().slice(0, 10);
  async function forceFill(testId, value) {
    const el = page.getByTestId(testId);
    if (!(await el.count())) return;
    await el.fill("");
    await el.fill(value);
  }
  await forceFill(
    "input-url",
    "https://www.target.com/p/apple-airtag/-/A-54191097",
  );
  await forceFill("input-price", "35");
  await forceFill("input-date", today);
  await forceFill("input-region", "TX");
  await forceFill("input-model", "AirTag");
  await forceFill("input-tcin", "54191097");
  await forceFill("input-upc", "194252096261");
  await forceFill("input-title", "Apple AirTag");

  // Prefer live: if demo scenario select exists, leave default but production ignores it
  await page.screenshot({
    path: path.join(proofDir, "01-form-ready.png"),
    fullPage: true,
  });

  await Promise.all([
    page.waitForURL(/\/purchases\/.+\/review/, { timeout: 120_000 }),
    page.getByTestId("submit-purchase").click(),
  ]);

  await page.screenshot({
    path: path.join(proofDir, "02-review.png"),
    fullPage: true,
  });

  const bodyText = await page.locator("body").innerText();
  const fixtureVisible =
    /DEMO FIXTURE DATA/i.test(bodyText) ||
    (await page.getByTestId("fixture-banner").isVisible().catch(() => false));
  const liveSource = await page
    .getByTestId("discovery-data-source")
    .textContent()
    .catch(() => null);
  const matchDecision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  const confirmTitle = await page
    .getByTestId("confirm-title")
    .textContent()
    .catch(() => null);
  const noCandidates = await page
    .getByTestId("no-candidates")
    .isVisible()
    .catch(() => false);
  const candidateCount = await page.getByTestId("candidate-row").count();
  const cannotConfirm = await page
    .getByTestId("cannot-confirm")
    .isVisible()
    .catch(() => false);

  out.steps.review = {
    url: page.url(),
    fixture_banner_visible: fixtureVisible,
    discovery_data_source: liveSource?.trim() ?? null,
    match_decision: matchDecision,
    confirm_title: confirmTitle?.trim() ?? null,
    no_candidates: noCandidates,
    candidate_count: candidateCount,
    cannot_confirm: cannotConfirm,
    body_snippet: bodyText.slice(0, 500),
  };

  if (fixtureVisible) {
    out.verdict = "NOBU_LIVE_ENROLLMENT_AND_CHECK_BLOCKED";
    out.blocker = "Fixture banner visible on production review";
    fs.writeFileSync(
      path.join(proofDir, "browser-proof.json"),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
    process.exit(1);
  }

  if (noCandidates || !confirmTitle) {
    out.verdict = "NOBU_LIVE_ENROLLMENT_AND_CHECK_BLOCKED";
    out.blocker = "No confirmable live candidate";
    fs.writeFileSync(
      path.join(proofDir, "browser-proof.json"),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
    process.exit(1);
  }

  await Promise.all([
    page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 60_000 }),
    page.getByTestId("confirm-candidate").click(),
  ]);

  await page.getByTestId("monitoring-proof").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.screenshot({
    path: path.join(proofDir, "03-monitoring.png"),
    fullPage: true,
  });

  const started = Date.now();
  await Promise.all([
    page.waitForURL(/checked=1|outcome=|\/alerts\//, { timeout: 120_000 }),
    page.getByTestId("run-check").click(),
  ]);
  const finalUrl = page.url();
  const u = new URL(finalUrl);
  out.steps.check = {
    elapsed_ms: Date.now() - started,
    final_url: finalUrl,
    outcome: u.searchParams.get("outcome"),
    data_source: u.searchParams.get("data_source"),
    error: u.searchParams.get("error"),
    on_alert: finalUrl.includes("/alerts/"),
  };

  await page.screenshot({
    path: path.join(proofDir, "04-after-check.png"),
    fullPage: true,
  });

  // Refresh persistence
  await page.reload({ waitUntil: "networkidle" });
  const afterBody = await page.locator("body").innerText();
  out.steps.refresh = {
    monitoring_visible: await page
      .getByTestId("monitoring-proof")
      .isVisible()
      .catch(() => false),
    has_price_or_alert:
      /\$\d|Potential recovery|observed|price/i.test(afterBody) ||
      (await page.getByTestId("action-center").isVisible().catch(() => false)),
    no_fixture: !/DEMO FIXTURE DATA/i.test(afterBody),
  };

  const pass =
    out.steps.check.data_source === "LIVE" &&
    !fixtureVisible &&
    out.steps.refresh.no_fixture &&
    out.steps.check.error == null &&
    (out.steps.check.outcome === "price_drop" ||
      out.steps.check.outcome === "no_lower" ||
      out.steps.check.outcome === "no_match" ||
      out.steps.check.on_alert ||
      out.steps.refresh.has_price_or_alert);

  // Prefer accepted price path
  const accepted =
    out.steps.check.data_source === "LIVE" &&
    !fixtureVisible &&
    (out.steps.check.outcome === "price_drop" ||
      out.steps.check.outcome === "no_lower" ||
      out.steps.check.on_alert);

  out.verdict = accepted
    ? "NOBU_LIVE_ENROLLMENT_AND_CHECK_PASS"
    : pass
      ? "NOBU_LIVE_ENROLLMENT_AND_CHECK_BLOCKED"
      : "NOBU_LIVE_ENROLLMENT_AND_CHECK_BLOCKED";

  if (!accepted) {
    out.blocker = `Check outcome=${out.steps.check.outcome} data_source=${out.steps.check.data_source}`;
  }

  fs.writeFileSync(
    path.join(proofDir, "browser-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        verdict: out.verdict,
        review: out.steps.review,
        check: out.steps.check,
        refresh: out.steps.refresh,
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(accepted ? 0 : 1);
} catch (e) {
  out.verdict = "NOBU_LIVE_ENROLLMENT_AND_CHECK_BLOCKED";
  out.error = String(e?.message || e);
  fs.writeFileSync(
    path.join(proofDir, "browser-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.error(out.error);
  await browser.close().catch(() => {});
  process.exit(1);
}
