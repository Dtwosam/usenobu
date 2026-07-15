/**
 * Prove multi-instance: after Find my product, cold browser without cookies → 404.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/find-product-navigation");
fs.mkdirSync(proofDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});
const btn = page.getByTestId("btn-manual-entry");
if (await btn.isVisible().catch(() => false)) {
  const e = await btn.getAttribute("aria-expanded");
  if (e !== "true") await btn.click();
}
await page.getByTestId("purchase-form").waitFor({ state: "visible" });
const today = new Date().toISOString().slice(0, 10);
async function f(id, v) {
  const el = page.getByTestId(id);
  if (await el.count()) await el.fill(v);
}
await f("input-url", "https://www.target.com/p/apple-airtag/-/A-54191097");
await f("input-price", "35");
await f("input-date", today);
await f("input-region", "TX");
await f("input-model", "AirTag");
await f("input-tcin", "54191097");
await f("input-upc", "194252096261");
await f("input-title", "Apple AirTag");

await Promise.all([
  page.waitForURL(/\/purchases\/[^/]+\/review/, { timeout: 120_000 }),
  page.getByTestId("submit-purchase").click(),
]);

const afterUrl = page.url();
const cookies = await ctx.cookies();
const body1 = await page.locator("body").innerText();

const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
const res2 = await page2.goto(afterUrl, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
const body2 = await page2.locator("body").innerText();

const out = {
  at: new Date().toISOString(),
  afterUrl,
  sameContext404: /could not be found/i.test(body1),
  sameContextConfirm: await page
    .getByTestId("confirm-candidate")
    .isVisible()
    .catch(() => false),
  cookies: cookies.map((c) => ({ name: c.name, len: c.value.length })),
  cookie_nobu: cookies.find((c) => c.name.includes("nobu")),
  coldStatus: res2?.status() ?? null,
  cold404: /could not be found/i.test(body2),
  coldSnippet: body2.slice(0, 400),
  root_cause_hypothesis:
    cookies.length === 0 || !cookies.some((c) => c.name.includes("nobu"))
      ? "SESSION_COOKIE_LOST_OR_NOT_SET"
      : "OTHER",
};
fs.writeFileSync(
  path.join(proofDir, "cookie-isolation.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(out.cold404 || out.root_cause_hypothesis.includes("COOKIE") ? 0 : 0);
