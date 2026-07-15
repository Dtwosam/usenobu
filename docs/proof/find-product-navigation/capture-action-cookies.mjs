/**
 * Capture all responses and Set-Cookie during Find my product submit.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/find-product-navigation");
const responses = [];

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("response", async (res) => {
  const headers = res.headers();
  const setCookie = headers["set-cookie"] || null;
  if (setCookie || res.url().includes("purchases") || res.request().method() === "POST") {
    responses.push({
      url: res.url().slice(0, 160),
      status: res.status(),
      method: res.request().method(),
      set_cookie: setCookie ? String(setCookie).slice(0, 220) : null,
      content_type: headers["content-type"] || null,
    });
  }
});

await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle" });
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

await Promise.all([
  page.waitForURL((u) => u.pathname.includes("/review"), { timeout: 120_000 }),
  page.getByTestId("submit-purchase").click(),
]);

const cookies = await ctx.cookies();
const out = {
  final_url: page.url(),
  cookie_count: cookies.length,
  cookies: cookies.map((c) => ({ name: c.name, len: c.value.length })),
  responses: responses.slice(-30),
};
fs.writeFileSync(
  path.join(proofDir, "action-cookies.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
await browser.close();
