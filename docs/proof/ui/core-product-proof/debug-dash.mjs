import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const proofDir = path.resolve("docs/proof/ui/core-product-proof");
fs.mkdirSync(proofDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
const btn = page.getByTestId("btn-manual-entry");
if (await btn.isVisible()) {
  const e = await btn.getAttribute("aria-expanded");
  if (e !== "true") await btn.click();
}
await page.getByTestId("purchase-form").waitFor({ state: "visible" });
const today = new Date().toISOString().slice(0, 10);
// Use a purchase date a few days ago so window is clearly open
const purchaseDate = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
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
console.log("review", page.url());
console.log(
  "decision",
  await page.getByTestId("match-decision").innerText().catch(() => "n/a"),
);
await Promise.all([
  page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 60_000 }),
  page.getByTestId("confirm-candidate").click(),
]);
console.log("dash", page.url());
console.log(
  "status",
  await page.getByTestId("status-pill").innerText().catch(() => "n/a"),
);
console.log(
  "code",
  await page.getByTestId("status-code").innerText().catch(() => "n/a"),
);
console.log("fp_count", await page.getByTestId("fingerprint-id").count());
console.log("run_count", await page.getByTestId("run-check").count());
console.log("proof_count", await page.getByTestId("monitoring-proof").count());
console.log(
  "body",
  (await page.locator("body").innerText()).slice(0, 1200),
);
await page.screenshot({
  path: path.join(proofDir, "debug-dash.png"),
  fullPage: true,
});
await browser.close();
