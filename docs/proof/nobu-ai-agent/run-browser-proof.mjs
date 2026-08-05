/**
 * Production browser proof for NL AI intake (Playwright).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const dir = "docs/proof/nobu-ai-agent";
const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
fs.mkdirSync(dir, { recursive: true });

const notes = [];
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
notes.push("opened_add_purchase");
await page.screenshot({
  path: path.join(dir, "01-add-purchase.png"),
  fullPage: true,
});

const text =
  "I bought a demo Target online item yesterday for $12.34. https://www.target.com/p/example-widget/-/A-87654321";
await page.getByTestId("input-purchase-text").fill(text);
notes.push("filled_nl");
await page.getByTestId("btn-fill-ai").click();
await page.getByTestId("ai-confirmation-gate").waitFor({ timeout: 30_000 });
notes.push("confirmation_gate_visible");
await page.screenshot({
  path: path.join(dir, "02-ai-filled.png"),
  fullPage: true,
});

const price = await page.getByTestId("input-price").inputValue();
const url = await page.getByTestId("input-url").inputValue();
notes.push(`price=${price}`, `url=${url}`);
await page.getByTestId("input-price").fill("11.00");
notes.push("edited_price");
// Stabilize for fixture matching after AI fill
await page
  .getByTestId("input-url")
  .fill("https://www.target.com/p/example-widget/-/A-87654321");
await page.getByTestId("input-tcin").fill("87654321");
await page.getByTestId("input-model").fill("WDG-100");
await page.getByTestId("input-date").fill("2026-07-05");
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-scenario").selectOption("exact_match");

await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);
notes.push(`review_url=${page.url()}`);
await page.screenshot({
  path: path.join(dir, "03-review.png"),
  fullPage: true,
});
const heading = await page
  .getByRole("heading", { name: /Confirm the exact product/i })
  .isVisible();
notes.push(`review_heading=${heading}`);

// Manual path
await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle" });
await page.getByTestId("btn-manual-entry").click();
await page.getByTestId("input-scenario").selectOption("exact_match");
await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);
notes.push(`manual_review=${page.url()}`);
await page.screenshot({
  path: path.join(dir, "04-manual-review.png"),
  fullPage: true,
});

await browser.close();

const result = {
  at: new Date().toISOString(),
  base,
  notes,
  ok: heading && notes.some((n) => n.startsWith("manual_review=")),
};
fs.writeFileSync(
  path.join(dir, "browser-notes.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
