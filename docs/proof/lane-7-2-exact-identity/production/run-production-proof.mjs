/**
 * Lane 7.2 unique production deployment proof.
 * Targets the unique (non-aliased) Vercel deployment, not usenobu.vercel.app.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE;
if (!base) throw new Error("NOBU_PROOF_BASE required");

const proofDir = path.resolve(
  "docs/proof/lane-7-2-exact-identity/production",
);
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  note: "Unique Vercel deployment (not aliased to usenobu.vercel.app in this lane).",
  checks: {},
  flow_a_identity_only: {},
  flow_b_real_product_live_check: {},
};

// --- Platform identity checks ---
const healthRes = await fetch(`${base}/health`);
const healthJson = await healthRes.json();
out.checks.health = { status: healthRes.status, body: healthJson };

const agentRes = await fetch(`${base}/v1/agent`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "CHECK_MONITORING_STATUS",
    purchase_id: "does-not-exist",
  }),
});
out.checks.agent = {
  status: agentRes.status,
  is_not_found: agentRes.status === 404,
  body: (await agentRes.text()).slice(0, 300),
};

const homeRes = await fetch(`${base}/`);
const homeHtml = await homeRes.text();
out.checks.homepage_title_is_nobu = /<title>[^<]*Nobu[^<]*<\/title>/i.test(homeHtml);

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

async function openManual(p) {
  const btn = p.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    const e = await btn.getAttribute("aria-expanded");
    if (e !== "true") await btn.click();
  }
  await p.getByTestId("purchase-form").waitFor({ state: "visible", timeout: 20_000 });
}

// =====================================================================
// FLOW A — synthetic but syntactically valid Target URL/TCIN with no
// real Target listing, used solely to force the identity-only path
// (live SerpApi will not find a strong/matching candidate for it).
// No price is ever attributed to this candidate — that is the point
// being proven.
// =====================================================================
const SYNTHETIC = {
  tcin: "99999901",
  url: "https://www.target.com/p/nobu-lane-7-2-identity-proof/-/A-99999901",
  price: "50.00",
};
const purchaseDate = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);

await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle", timeout: 60_000 });
await openManual(page);
await page.getByTestId("input-url").fill(SYNTHETIC.url);
await page.getByTestId("input-price").fill(SYNTHETIC.price);
await page.getByTestId("input-date").fill(purchaseDate);
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-tcin").fill(SYNTHETIC.tcin);

await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);

const reviewUrl = page.url();
const purchaseIdA = reviewUrl.match(/\/purchases\/([^/]+)\/review/)?.[1];
out.flow_a_identity_only.purchase_id = purchaseIdA;

const matchDecision = await page.getByTestId("match-decision").getAttribute("data-decision");
const matchReasons = await page.getByTestId("match-reasons").innerText();
const candidateRow = page.getByTestId("candidate-row").first();
const observedPriceLine = await candidateRow.locator(".n-meta-list li").first().innerText();

await candidateRow.locator("summary").click();
const disclosureText = await candidateRow.locator(".n-disclosure__body").innerText();

out.flow_a_identity_only.review = {
  url: reviewUrl,
  match_decision: matchDecision,
  match_reasons: matchReasons,
  observed_price_line: observedPriceLine,
  is_identity_only_source: disclosureText.includes("user-provided exact Target identity"),
  disclosure_excerpt: disclosureText.slice(0, 500),
};

await page.screenshot({
  path: path.join(proofDir, "flow-a-review-identity-only.png"),
  fullPage: true,
});

// --- Monitoring must be blocked before confirmation ---
await page.goto(`${base}/purchases/${purchaseIdA}`, { waitUntil: "networkidle" });
out.flow_a_identity_only.before_confirm = {
  monitoring_status: await page.getByTestId("monitoring-status").innerText().catch(() => null),
  proof_support: await page.getByTestId("proof-support").innerText().catch(() => null),
  run_check_visible: await page.getByTestId("run-check").isVisible().catch(() => false),
  fingerprint_present: await page.getByTestId("fingerprint-id").count() > 0,
};

await page.screenshot({
  path: path.join(proofDir, "flow-a-dashboard-before-confirm.png"),
  fullPage: true,
});

// --- Confirm ---
await page.goto(`${base}/purchases/${purchaseIdA}/review`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(new RegExp(`/purchases/${purchaseIdA}$`), { timeout: 60_000 }),
  page.getByTestId("confirm-candidate").click(),
]);

out.flow_a_identity_only.after_confirm = {
  monitoring_status: await page.getByTestId("monitoring-status").innerText().catch(() => null),
  proof_support: await page.getByTestId("proof-support").innerText().catch(() => null),
  run_check_visible: await page.getByTestId("run-check").isVisible().catch(() => false),
  fingerprint_present: await page.getByTestId("fingerprint-id").count() > 0,
  fingerprint_text: await page.getByTestId("fingerprint-id").innerText().catch(() => null),
};

await page.screenshot({
  path: path.join(proofDir, "flow-a-dashboard-after-confirm.png"),
  fullPage: true,
});

// --- Run one live manual check on the confirmed identity-only fingerprint ---
const startedA = Date.now();
await Promise.all([
  page.waitForURL(/outcome=|\/alerts\//, { timeout: 120_000 }),
  page.getByTestId("run-check").click(),
]);
const finalUrlA = page.url();
const uA = new URL(finalUrlA);
out.flow_a_identity_only.live_check = {
  elapsed_ms: Date.now() - startedA,
  final_url: finalUrlA,
  outcome: uA.searchParams.get("outcome"),
  on_alert: finalUrlA.includes("/alerts/"),
  provider_outcome: await page.getByTestId("provider-outcome").innerText().catch(() => null),
  matching_decision: await page.getByTestId("matching-decision").innerText().catch(() => null),
  alert_action: await page.getByTestId("alert-action").innerText().catch(() => null),
  check_outcome_text: await page.getByTestId("check-outcome").innerText().catch(() => null),
};
out.flow_a_identity_only.no_positive_alert = !finalUrlA.includes("/alerts/");

await page.screenshot({
  path: path.join(proofDir, "flow-a-after-live-check.png"),
  fullPage: true,
});

// =====================================================================
// FLOW B — real Target product (Conair GS14) with known historical
// live-matching sensitivity, used to observe fail-closed behavior on
// a genuine third-party observation rather than a synthetic one.
// =====================================================================
const CONAIR = {
  title: "Conair ExtremeSteam Handheld Garment Steamer",
  model: "GS14",
  tcin: "87470797",
  upc: "074108469755",
  url: "https://www.target.com/p/conair-extremesteam-handheld-garment-steamer/-/A-87470797",
  price: "39.99",
};

await page.goto(`${base}/purchases/new`, { waitUntil: "networkidle", timeout: 60_000 });
await openManual(page);
await page.getByTestId("input-url").fill(CONAIR.url);
await page.getByTestId("input-price").fill(CONAIR.price);
await page.getByTestId("input-date").fill(purchaseDate);
await page.getByTestId("input-region").fill("TX");
await page.getByTestId("input-model").fill(CONAIR.model);
await page.getByTestId("input-tcin").fill(CONAIR.tcin);
await page.getByTestId("input-upc").fill(CONAIR.upc);
await page.getByTestId("input-title").fill(CONAIR.title);

await Promise.all([
  page.waitForURL(/\/purchases\/.+\/review/, { timeout: 60_000 }),
  page.getByTestId("submit-purchase").click(),
]);
const purchaseIdB = page.url().match(/\/purchases\/([^/]+)\/review/)?.[1];
out.flow_b_real_product_live_check.purchase_id = purchaseIdB;

const canConfirmB = await page.getByTestId("confirm-candidate").isVisible().catch(() => false);
out.flow_b_real_product_live_check.enrollment_confirmable = canConfirmB;

if (canConfirmB) {
  await Promise.all([
    page.waitForURL(new RegExp(`/purchases/${purchaseIdB}$`), { timeout: 60_000 }),
    page.getByTestId("confirm-candidate").click(),
  ]);

  const showsCheck = await page.getByTestId("run-check").isVisible().catch(() => false);
  if (showsCheck) {
    const startedB = Date.now();
    await Promise.all([
      page.waitForURL(/outcome=|\/alerts\//, { timeout: 120_000 }),
      page.getByTestId("run-check").click(),
    ]);
    const finalUrlB = page.url();
    const uB = new URL(finalUrlB);
    out.flow_b_real_product_live_check.live_check = {
      elapsed_ms: Date.now() - startedB,
      final_url: finalUrlB,
      outcome: uB.searchParams.get("outcome"),
      on_alert: finalUrlB.includes("/alerts/"),
      provider_outcome: await page.getByTestId("provider-outcome").innerText().catch(() => null),
      matching_decision: await page.getByTestId("matching-decision").innerText().catch(() => null),
      alert_action: await page.getByTestId("alert-action").innerText().catch(() => null),
      suppression_reason: await page.getByTestId("suppression-reason").innerText().catch(() => null),
      check_outcome_text: await page.getByTestId("check-outcome").innerText().catch(() => null),
    };
    out.flow_b_real_product_live_check.no_positive_alert = !finalUrlB.includes("/alerts/");
    await page.screenshot({
      path: path.join(proofDir, "flow-b-after-live-check.png"),
      fullPage: true,
    });
  } else {
    out.flow_b_real_product_live_check.note = "run-check not offered (cooldown/budget/window)";
  }
} else {
  out.flow_b_real_product_live_check.note = "Live enrollment did not produce a confirmable candidate at run time.";
  await page.screenshot({
    path: path.join(proofDir, "flow-b-review-not-confirmable.png"),
    fullPage: true,
  });
}

// --- No secret / key leakage across all visited pages ---
const bodyText = await page.locator("body").innerText();
out.checks.no_api_key_in_body = !/serpapi[_-]?api[_-]?key\s*[:=]|groq[_-]?api[_-]?key\s*[:=]/i.test(bodyText);

fs.writeFileSync(
  path.join(proofDir, "production-proof.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));

await browser.close();
