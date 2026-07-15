/**
 * Mandatory production proof: Find product → no 404 → confirm → monitoring → refresh.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/find-product-navigation");
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  steps: {},
  verdict: null,
};

// Health + frozen agent
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
const setCookies = [];
page.on("response", (res) => {
  const sc = res.headers()["set-cookie"];
  if (sc) {
    setCookies.push({
      url: res.url().slice(0, 100),
      has_nobu: /nobu_demo_state/i.test(sc),
      len: String(sc).length,
    });
  }
});

try {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  }
  await page.getByTestId("purchase-form").waitFor({ state: "visible" });
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

  out.steps.before_url = page.url();
  await page.screenshot({
    path: path.join(proofDir, "01-before-find.png"),
    fullPage: true,
  });

  await Promise.all([
    page.waitForURL(
      (u) =>
        u.pathname.includes("/review") ||
        u.searchParams.has("error") ||
        /could not be found/i.test(u.pathname),
      { timeout: 120_000 },
    ),
    page.getByTestId("submit-purchase").click(),
  ]);

  const afterUrl = page.url();
  const body = await page.locator("body").innerText();
  const is404 = /This page could not be found/i.test(body);
  const purchaseId =
    afterUrl.match(/\/purchases\/(pur_[a-f0-9]{12})/i)?.[1] ?? null;
  const onReview = /\/review/.test(afterUrl);
  const onFormError =
    afterUrl.includes("/purchases/new") && afterUrl.includes("error=");

  out.steps.after_find = {
    url: afterUrl,
    is_404: is404,
    purchase_id: purchaseId,
    on_review: onReview,
    on_form_error: onFormError,
    fixture_banner: await page
      .getByTestId("fixture-banner")
      .isVisible()
      .catch(() => false),
    discovery_source: (
      await page
        .getByTestId("discovery-data-source")
        .textContent()
        .catch(() => null)
    )?.trim(),
    confirm_title: (
      await page.getByTestId("confirm-title").textContent().catch(() => null)
    )?.trim(),
    cookies: (await context.cookies()).map((c) => ({
      name: c.name,
      len: c.value.length,
    })),
    set_cookie_signals: setCookies.slice(-5),
  };

  await page.screenshot({
    path: path.join(proofDir, "02-after-find.png"),
    fullPage: true,
  });

  if (is404 || !onReview || !purchaseId) {
    out.verdict = "NOBU_FIND_PRODUCT_NAVIGATION_BLOCKED";
    out.blocker = is404
      ? "404 after Find my product"
      : `Unexpected navigation: ${afterUrl}`;
    fs.writeFileSync(
      path.join(proofDir, "production-proof.json"),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
    process.exit(1);
  }

  // Confirm product
  await Promise.all([
    page.waitForURL(/\/purchases\/pur_[a-f0-9]+$/i, { timeout: 60_000 }),
    page.getByTestId("confirm-candidate").click(),
  ]);
  await page.getByTestId("monitoring-proof").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  out.steps.monitoring = {
    url: page.url(),
    monitoring_visible: true,
  };
  await page.screenshot({
    path: path.join(proofDir, "03-monitoring.png"),
    fullPage: true,
  });

  // Refresh
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.locator("body").innerText();
  out.steps.refresh = {
    url: page.url(),
    monitoring_visible: await page
      .getByTestId("monitoring-proof")
      .isVisible()
      .catch(() => false),
    no_404: !/could not be found/i.test(afterReload),
    no_fixture: !/DEMO FIXTURE DATA/i.test(afterReload),
  };

  await page.screenshot({
    path: path.join(proofDir, "04-refresh.png"),
    fullPage: true,
  });

  const pass =
    !is404 &&
    onReview &&
    purchaseId &&
    out.steps.after_find.confirm_title &&
    !out.steps.after_find.fixture_banner &&
    out.steps.monitoring.monitoring_visible &&
    out.steps.refresh.no_404 &&
    out.steps.refresh.no_fixture;

  out.verdict = pass
    ? "NOBU_FIND_PRODUCT_NAVIGATION_PASS"
    : "NOBU_FIND_PRODUCT_NAVIGATION_BLOCKED";

  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        verdict: out.verdict,
        after_find: out.steps.after_find,
        monitoring: out.steps.monitoring,
        refresh: out.steps.refresh,
      },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(pass ? 0 : 1);
} catch (e) {
  out.verdict = "NOBU_FIND_PRODUCT_NAVIGATION_BLOCKED";
  out.error = String(e?.message || e);
  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.error(out.error);
  await browser.close().catch(() => {});
  process.exit(1);
}
