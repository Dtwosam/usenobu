/**
 * Reproduce Find my product navigation on production.
 * Captures redirect URL, status, and page body signals.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve("docs/proof/find-product-navigation");
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  before_url: null,
  after_url: null,
  http_status: null,
  is_404: null,
  body_snippet: null,
  purchase_id_from_url: null,
  route_exists_in_app: "app/purchases/[id]/review/page.tsx",
  cookies: [],
  console_errors: [],
  network_redirects: [],
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") out.console_errors.push(msg.text().slice(0, 200));
});
page.on("response", (res) => {
  if (res.request().isNavigationRequest()) {
    out.network_redirects.push({
      url: res.url(),
      status: res.status(),
    });
  }
});

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});

// open manual form
const btn = page.getByTestId("btn-manual-entry");
if (await btn.isVisible().catch(() => false)) {
  const e = await btn.getAttribute("aria-expanded");
  if (e !== "true") await btn.click();
}
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 20_000 });

const today = new Date().toISOString().slice(0, 10);
async function forceFill(id, v) {
  const el = page.getByTestId(id);
  if (await el.count()) {
    await el.fill("");
    await el.fill(v);
  }
}
await forceFill("input-url", "https://www.target.com/p/apple-airtag/-/A-54191097");
await forceFill("input-price", "35");
await forceFill("input-date", today);
await forceFill("input-region", "TX");
await forceFill("input-model", "AirTag");
await forceFill("input-tcin", "54191097");
await forceFill("input-upc", "194252096261");
await forceFill("input-title", "Apple AirTag");

out.before_url = page.url();
await page.screenshot({ path: path.join(proofDir, "01-before-submit.png"), fullPage: true });

// Submit and wait for navigation
const [response] = await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120_000 }),
  page.getByTestId("submit-purchase").click(),
]);

out.after_url = page.url();
out.http_status = response?.status() ?? null;
const body = await page.locator("body").innerText();
out.body_snippet = body.slice(0, 800);
out.is_404 =
  /This page could not be found/i.test(body) ||
  out.http_status === 404 ||
  /404/.test(await page.title().catch(() => ""));
const m = String(out.after_url).match(/\/purchases\/([^/?#]+)/);
out.purchase_id_from_url = m?.[1] ?? null;
out.cookies = (await context.cookies()).map((c) => ({
  name: c.name,
  value_len: c.value?.length ?? 0,
  path: c.path,
}));

await page.screenshot({ path: path.join(proofDir, "02-after-submit.png"), fullPage: true });

// If review loaded, note candidate state
out.review_signals = {
  has_confirm: await page.getByTestId("confirm-candidate").isVisible().catch(() => false),
  has_fixture: await page.getByTestId("fixture-banner").isVisible().catch(() => false),
  discovery_source: await page
    .getByTestId("discovery-data-source")
    .textContent()
    .catch(() => null),
  no_candidates: await page.getByTestId("no-candidates").isVisible().catch(() => false),
};

fs.writeFileSync(path.join(proofDir, "reproduce.json"), JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      before: out.before_url,
      after: out.after_url,
      status: out.http_status,
      is_404: out.is_404,
      purchase_id: out.purchase_id_from_url,
      cookie_lens: out.cookies.map((c) => `${c.name}:${c.value_len}`),
      review: out.review_signals,
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(out.is_404 ? 1 : 0);
