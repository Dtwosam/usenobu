/**
 * Production smoke for manual-entry disclosure hotfix.
 * Saves screenshots + redacted JSON under this directory.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://www.usenobu.xyz";
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
// On Windows, file URL pathname may be /C:/... — normalize
const proofDir = path.resolve("docs/proof/ui/manual-entry-hotfix");
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  checks: {},
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});

// Initial state
const formBefore = await page.getByTestId("purchase-form").count();
const btn = page.getByTestId("btn-manual-entry");
await btn.waitFor({ state: "visible", timeout: 20_000 });
const label0 = (await btn.innerText()).trim();
const expanded0 = await btn.getAttribute("aria-expanded");
const type0 = await btn.getAttribute("type");
const controls0 = await btn.getAttribute("aria-controls");
await page.screenshot({
  path: path.join(proofDir, "01-initial-collapsed.png"),
  fullPage: true,
});

out.checks.initial = {
  form_count: formBefore,
  form_hidden: formBefore === 0,
  button_label: label0,
  aria_expanded: expanded0,
  type: type0,
  aria_controls: controls0,
  fill_ai_visible: await page.getByTestId("btn-fill-ai").isVisible(),
  nl_visible: await page.getByTestId("input-purchase-text").isVisible(),
};

// Open via click
await btn.click();
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 15_000 });
const label1 = (await btn.innerText()).trim();
const expanded1 = await btn.getAttribute("aria-expanded");
await page.getByTestId("input-price").fill("15.55");
await page.getByTestId("input-title").fill("Preserve me");
await page.screenshot({
  path: path.join(proofDir, "02-manual-open.png"),
  fullPage: true,
});

out.checks.open = {
  form_visible: true,
  button_label: label1,
  aria_expanded: expanded1,
};

// Collapse + reopen preserves values
await btn.click();
await page.getByTestId("purchase-form").waitFor({ state: "hidden", timeout: 10_000 }).catch(async () => {
  // form unmounted when collapsed
  if ((await page.getByTestId("purchase-form").count()) !== 0) {
    throw new Error("form still present after hide");
  }
});
const label2 = (await btn.innerText()).trim();
await btn.click();
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 15_000 });
const priceKept = await page.getByTestId("input-price").inputValue();
const titleKept = await page.getByTestId("input-title").inputValue();
await page.screenshot({
  path: path.join(proofDir, "03-reopen-preserved.png"),
  fullPage: true,
});

out.checks.preserve = {
  after_hide_label: label2,
  price: priceKept,
  title: titleKept,
  price_ok: priceKept === "15.55",
  title_ok: titleKept === "Preserve me",
};

// Keyboard open on fresh load
await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle" });
const kbBtn = page.getByTestId("btn-manual-entry");
await kbBtn.focus();
await page.keyboard.press("Enter");
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 15_000 });
out.checks.keyboard_enter = { form_visible: true };

// Overflow 320
await page.setViewportSize({ width: 320, height: 800 });
await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle" });
await page.getByTestId("btn-manual-entry").click();
await page.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 15_000 });
const overflow = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
}));
out.checks.overflow_320 = {
  ...overflow,
  ok: overflow.sw <= overflow.cw + 1,
};
await page.screenshot({
  path: path.join(proofDir, "04-mobile-320-open.png"),
  fullPage: true,
});

await browser.close();

const pass =
  out.checks.initial.form_hidden &&
  out.checks.initial.button_label === "Enter details manually" &&
  out.checks.initial.aria_expanded === "false" &&
  out.checks.initial.type === "button" &&
  out.checks.open.button_label === "Hide manual form" &&
  out.checks.open.aria_expanded === "true" &&
  out.checks.preserve.price_ok &&
  out.checks.preserve.title_ok &&
  out.checks.keyboard_enter.form_visible &&
  out.checks.overflow_320.ok;

out.verdict = pass ? "NOBU_UI_HOTFIX_1_PASS" : "NOBU_UI_HOTFIX_1_BLOCKED";
fs.writeFileSync(path.join(proofDir, "prod-smoke.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
if (!pass) process.exit(1);
