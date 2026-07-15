/**
 * Gate 1–2: capture live discovery ambiguity for AirTag enrollment.
 * One Find-my-product flow; records identifiers + candidate cards.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/live-discovery-deduplication");
fs.mkdirSync(proofDir, { recursive: true });

const TEXT =
  "For testing, I bought an Apple AirTag from Target.com today for $35. The TCIN is 54191097, and the product link is https://www.target.com/p/apple-airtag/-/A-54191097.";

const out = {
  at: new Date().toISOString(),
  base,
  gate1: {},
  gate2: {},
  classification: null,
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${base}/purchases/new`, {
  waitUntil: "networkidle",
  timeout: 60_000,
});

// AI path if available
const aiBox = page.getByTestId("ai-purchase-text");
if (await aiBox.isVisible().catch(() => false)) {
  await aiBox.fill(TEXT);
  const extract = page.getByTestId("ai-extract-submit");
  if (await extract.isVisible().catch(() => false)) {
    await extract.click();
    await page.waitForTimeout(4000);
  }
}

const btn = page.getByTestId("btn-manual-entry");
if (await btn.isVisible().catch(() => false)) {
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
}
await page.getByTestId("purchase-form").waitFor({ state: "visible" });

const today = new Date().toISOString().slice(0, 10);
async function force(id, v) {
  const el = page.getByTestId(id);
  if (await el.count()) {
    await el.fill("");
    await el.fill(v);
  }
}
// Force known good identifiers (survive into discovery)
await force(
  "input-url",
  "https://www.target.com/p/apple-airtag/-/A-54191097",
);
await force("input-price", "35");
await force("input-date", today);
await force("input-region", "TX");
await force("input-model", "AirTag");
await force("input-tcin", "54191097");
await force("input-upc", "194252096261");
await force("input-title", "Apple AirTag");

const formTcin = await page.getByTestId("input-tcin").inputValue();
const formUrl = await page.getByTestId("input-url").inputValue();
const formModel = await page.getByTestId("input-model").inputValue();
const formTitle = await page.getByTestId("input-title").inputValue();
const formUpc = await page.getByTestId("input-upc").inputValue();

out.gate1.form = {
  tcin: formTcin,
  url: formUrl,
  model: formModel,
  title: formTitle,
  upc: formUpc,
  tcin_survives: formTcin === "54191097",
  url_has_tcin: /A-54191097/i.test(formUrl),
};

await page.screenshot({
  path: path.join(proofDir, "01-form.png"),
  fullPage: true,
});

await Promise.all([
  page.waitForURL(
    (u) =>
      u.pathname.includes("/review") || u.searchParams.has("error"),
    { timeout: 120_000 },
  ),
  page.getByTestId("submit-purchase").click(),
]);

const afterUrl = page.url();
const body = await page.locator("body").innerText();
const decision = await page
  .getByTestId("match-decision")
  .getAttribute("data-decision")
  .catch(() => null);
const reasons = await page
  .getByTestId("match-reasons")
  .textContent()
  .catch(() => null);
const source = await page
  .getByTestId("discovery-data-source")
  .textContent()
  .catch(() => null);
const ambiguous = await page
  .getByTestId("ambiguous-notice")
  .isVisible()
  .catch(() => false);
const ambiguousText = ambiguous
  ? await page.getByTestId("ambiguous-notice").innerText()
  : null;

const rows = page.getByTestId("candidate-row");
const n = await rows.count();
const candidates = [];
for (let i = 0; i < n; i++) {
  const row = rows.nth(i);
  const text = await row.innerText();
  const tier = await row.getAttribute("data-tier");
  candidates.push({ index: i, tier, text: text.slice(0, 400) });
}

out.gate1.discovery = {
  after_url: afterUrl,
  data_source: source?.trim() ?? null,
  match_decision: decision,
  match_reasons: reasons?.trim() ?? null,
  ambiguous_ui: ambiguous,
  ambiguous_copy: ambiguousText?.slice(0, 400) ?? null,
  candidate_count: n,
  candidates,
  body_has_more_detail: /We need a little more detail/i.test(body),
  body_asks_add_tcin: /Add a model, TCIN or UPC/i.test(body),
};

// Classify from UI text (no raw provider payload)
const titles = candidates.map((c) => {
  const line = c.text.split("\n")[0] || c.text;
  return line.trim();
});
const accessory = titles.some((t) =>
  /loop|case|keychain|holder|strap|wallet|insert|band/i.test(t),
);
const allAirTagCore = titles.every(
  (t) => /air\s*tag/i.test(t) && !/loop|case|keychain|holder|strap|wallet/i.test(t),
);
const sameTitle = new Set(titles.map((t) => t.toLowerCase())).size === 1;

let classification = "GENUINELY_DIFFERENT_PRODUCTS";
if (n <= 1 && decision === "EXACT_MATCH_CANDIDATE") {
  classification = "NO_AMBIGUITY";
} else if (accessory) {
  classification = "ACCESSORY_CONTAMINATION";
} else if (sameTitle || allAirTagCore) {
  classification = "DUPLICATE_SAME_PRODUCT_OFFERS";
} else if (ambiguous && formTcin === "54191097") {
  classification =
    n > 1 ? "DUPLICATE_SAME_PRODUCT_OFFERS" : "AMBIGUITY_UI_DEFECT";
}

out.gate2 = {
  titles,
  same_title: sameTitle,
  accessory_present: accessory,
  all_airtag_core: allAirTagCore,
  form_tcin_present: formTcin === "54191097",
  classification_hypothesis: classification,
};

out.classification = classification;

await page.screenshot({
  path: path.join(proofDir, "02-review.png"),
  fullPage: true,
});

fs.writeFileSync(
  path.join(proofDir, "capture.json"),
  JSON.stringify(out, null, 2),
);
console.log(
  JSON.stringify(
    {
      decision,
      candidate_count: n,
      titles,
      ambiguous,
      asks_add_tcin: out.gate1.discovery.body_asks_add_tcin,
      classification,
      tcin_survives: out.gate1.form.tcin_survives,
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(0);
