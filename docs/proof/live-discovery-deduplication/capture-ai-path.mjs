/**
 * Reproduce user path: AI sentence → Find product (minimal force-fill).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve("docs/proof/live-discovery-deduplication");
const TEXT =
  "For testing, I bought an Apple AirTag from Target.com today for $35. The TCIN is 54191097, and the product link is https://www.target.com/p/apple-airtag/-/A-54191097.";

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle", timeout: 60_000 });

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
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 20_000 });

const form = {
  url: await page.getByTestId("input-url").inputValue().catch(() => ""),
  tcin: await page.getByTestId("input-tcin").inputValue().catch(() => ""),
  model: await page.getByTestId("input-model").inputValue().catch(() => ""),
  title: await page.getByTestId("input-title").inputValue().catch(() => ""),
  price: await page.getByTestId("input-price").inputValue().catch(() => ""),
  date: await page.getByTestId("input-date").inputValue().catch(() => ""),
  upc: await page.getByTestId("input-upc").inputValue().catch(() => ""),
};

// Only fill missing required fields; do not overwrite AI
const today = new Date().toISOString().slice(0, 10);
async function fillIfEmpty(id, v) {
  const el = page.getByTestId(id);
  if (!(await el.count())) return;
  const cur = await el.inputValue();
  if (!cur?.trim()) await el.fill(v);
}
await fillIfEmpty("input-url", "https://www.target.com/p/apple-airtag/-/A-54191097");
await fillIfEmpty("input-price", "35");
await fillIfEmpty("input-date", today);
await fillIfEmpty("input-region", "TX");
await fillIfEmpty("input-tcin", "54191097");
await fillIfEmpty("input-model", "AirTag");
await fillIfEmpty("input-title", "Apple AirTag");
await fillIfEmpty("input-upc", "194252096261");

const formAfter = {
  url: await page.getByTestId("input-url").inputValue(),
  tcin: await page.getByTestId("input-tcin").inputValue(),
  model: await page.getByTestId("input-model").inputValue(),
  title: await page.getByTestId("input-title").inputValue(),
};

await Promise.all([
  page.waitForURL((u) => u.pathname.includes("/review") || u.searchParams.has("error"), {
    timeout: 120_000,
  }),
  page.getByTestId("submit-purchase").click(),
]);

const body = await page.locator("body").innerText();
const n = await page.getByTestId("candidate-row").count();
const titles = [];
for (let i = 0; i < n; i++) {
  const t = await page.getByTestId("candidate-row").nth(i).innerText();
  titles.push(t.split("\n")[0]?.trim());
}
const out = {
  form_before_submit_ai: form,
  form_after_fill: formAfter,
  url: page.url(),
  decision: await page.getByTestId("match-decision").getAttribute("data-decision").catch(() => null),
  reasons: await page.getByTestId("match-reasons").textContent().catch(() => null),
  ambiguous: await page.getByTestId("ambiguous-notice").isVisible().catch(() => false),
  ambiguous_text: (await page.getByTestId("ambiguous-notice").innerText().catch(() => "")).slice(0, 500),
  candidate_count: n,
  titles,
  asks_add_tcin: /Add a model, TCIN or UPC/i.test(body),
  has_more_detail: /We need a little more detail/i.test(body),
};
await page.screenshot({ path: path.join(proofDir, "03-ai-path-review.png"), fullPage: true });
fs.writeFileSync(path.join(proofDir, "capture-ai-path.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
