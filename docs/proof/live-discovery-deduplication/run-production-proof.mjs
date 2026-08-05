/**
 * Production proof: AirTag AI/manual path → one candidate → confirm → check.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve("docs/proof/live-discovery-deduplication");
fs.mkdirSync(proofDir, { recursive: true });

const TEXT =
  "For testing, I bought an Apple AirTag from Target.com today for $35. The TCIN is 54191097, and the product link is https://www.target.com/p/apple-airtag/-/A-54191097.";

const out = { at: new Date().toISOString(), base, steps: {}, verdict: null };

{
  const h = await fetch(`${base}/health`);
  out.steps.health = { status: h.status, body: await h.json() };
  const a = await fetch(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CHECK_MONITORING_STATUS",
      purchase_id: "pur_x",
    }),
  });
  out.steps.agent = {
    status: a.status,
    frozen: a.status === 404,
    body: (await a.text()).slice(0, 120),
  };
}

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();

try {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  const aiBox = page.getByTestId("ai-purchase-text");
  if (await aiBox.isVisible().catch(() => false)) {
    await aiBox.fill(TEXT);
    const extract = page.getByTestId("ai-extract-submit");
    if (await extract.isVisible().catch(() => false)) {
      await extract.click();
      await page.waitForTimeout(5000);
    }
  }

  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  }
  await page.getByTestId("purchase-form").waitFor({ state: "visible" });

  // Ensure identifiers (overwrite any leftovers)
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, v] of [
    ["input-url", "https://www.target.com/p/apple-airtag/-/A-54191097"],
    ["input-price", "35"],
    ["input-date", today],
    ["input-region", "TX"],
    ["input-model", "AirTag"],
    ["input-tcin", "54191097"],
    ["input-upc", "194252096261"],
    ["input-title", "Apple AirTag"],
  ]) {
    await page.getByTestId(id).fill(v);
  }

  out.steps.form = {
    tcin: await page.getByTestId("input-tcin").inputValue(),
    url: await page.getByTestId("input-url").inputValue(),
  };

  await Promise.all([
    page.waitForURL(
      (u) => u.pathname.includes("/review") || u.searchParams.has("error"),
      { timeout: 120_000 },
    ),
    page.getByTestId("submit-purchase").click(),
  ]);

  const body = await page.locator("body").innerText();
  const n = await page.getByTestId("candidate-row").count();
  const decision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  const confirmTitle = await page
    .getByTestId("confirm-title")
    .textContent()
    .catch(() => null);
  const ambiguous = await page
    .getByTestId("ambiguous-notice")
    .isVisible()
    .catch(() => false);
  const ambBody = await page
    .getByTestId("ambiguous-body")
    .textContent()
    .catch(() => null);

  out.steps.review = {
    url: page.url(),
    decision,
    candidate_count: n,
    confirm_title: confirmTitle?.trim() ?? null,
    ambiguous,
    ambiguous_body: ambBody?.trim() ?? null,
    is_404: /could not be found/i.test(body),
    asks_add_tcin: /Add a.*TCIN/i.test(body),
    fixture: await page
      .getByTestId("fixture-banner")
      .isVisible()
      .catch(() => false),
  };

  await page.screenshot({
    path: path.join(proofDir, "04-production-review.png"),
    fullPage: true,
  });

  if (
    out.steps.review.is_404 ||
    decision !== "EXACT_MATCH_CANDIDATE" ||
    n !== 1 ||
    !confirmTitle ||
    out.steps.review.fixture
  ) {
    out.verdict = "NOBU_DISCOVERY_DEDUP_BLOCKED";
    out.blocker = `decision=${decision} candidates=${n} confirm=${confirmTitle}`;
    fs.writeFileSync(
      path.join(proofDir, "production-proof.json"),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
    process.exit(1);
  }

  await Promise.all([
    page.waitForURL(/\/purchases\/pur_[a-f0-9]+$/i, { timeout: 60_000 }),
    page.getByTestId("confirm-candidate").click(),
  ]);
  await page.getByTestId("monitoring-proof").waitFor({ state: "visible" });

  await Promise.all([
    page.waitForURL(/checked=1|outcome=|\/alerts\//, { timeout: 120_000 }),
    page.getByTestId("run-check").click(),
  ]);
  const checkUrl = page.url();
  const u = new URL(checkUrl);
  out.steps.check = {
    url: checkUrl,
    outcome: u.searchParams.get("outcome"),
    data_source: u.searchParams.get("data_source"),
    error: u.searchParams.get("error"),
  };

  await page.screenshot({
    path: path.join(proofDir, "05-after-check.png"),
    fullPage: true,
  });

  const pass =
    out.steps.check.data_source === "LIVE" &&
    !out.steps.check.error &&
    (out.steps.check.outcome === "price_drop" ||
      out.steps.check.outcome === "no_lower" ||
      checkUrl.includes("/alerts/"));

  out.verdict = pass
    ? "NOBU_DISCOVERY_DEDUP_PASS"
    : "NOBU_DISCOVERY_DEDUP_BLOCKED";
  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify({ verdict: out.verdict, review: out.steps.review, check: out.steps.check }, null, 2));
  await browser.close();
  process.exit(pass ? 0 : 1);
} catch (e) {
  out.verdict = "NOBU_DISCOVERY_DEDUP_BLOCKED";
  out.error = String(e?.message || e);
  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.error(out.error);
  await browser.close().catch(() => {});
  process.exit(1);
}
