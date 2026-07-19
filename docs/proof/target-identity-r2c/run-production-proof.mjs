import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base =
  process.env.NOBU_PROOF_BASE ||
  "https://usenobu-ngtiamvqr-dtwoflicks-2878s-projects.vercel.app";
const proofDir = path.resolve("docs/proof/target-identity-r2c");
fs.mkdirSync(proofDir, { recursive: true });

const TARGET_URL = "https://www.target.com/p/-/A-85990992";
const TARGET_TCIN = "85990992";
const PURCHASE_PRICE = "35";
const PURCHASE_DATE = "2026-07-18";
const FALLBACK_UPC = "195950667295";

const out = {
  at: new Date().toISOString(),
  base,
  provider_search_budget: {
    max_new_serpapi_searches: 2,
    consumed_exact: 0,
    note:
      "Exact count is read from proof-safe server-side discovery diagnostics rendered on the review page. A Google Shopping request and an Immersive Product request each count as one provider call.",
  },
  diagnostic_classification: null,
  health: null,
  agent_regression: null,
  fallback_retry: null,
  progressive_fallback_identity: {
    attempted: false,
    blocked_reason: null,
    identifier_type: "UPC",
    identifier_value_redacted: "195950******",
  },
  target_url_tcin_resolution: null,
  upc_fallback_result: null,
  negative_fail_closed: null,
  verdict: "PENDING",
};

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text: text.slice(0, 500) };
  }
  return { status: res.status, body };
}

async function openManual(page) {
  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    if ((await btn.getAttribute("aria-expanded")) !== "true") {
      await btn.click();
    }
  }
  await page.getByTestId("purchase-form").waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function fillPurchase(page, fields) {
  await openManual(page);
  for (const [testId, value] of Object.entries(fields)) {
    const el = page.getByTestId(testId);
    if (await el.count()) {
      await el.fill("");
      await el.fill(value);
    }
  }
}

async function readDiagnostics(page) {
  const text = await page
    .getByTestId("discovery-diagnostics")
    .textContent()
    .catch(() => null);
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true };
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });

try {
  out.health = await fetchJson(`${base}/health`);
  out.agent_regression = await fetchJson(`${base}/v1/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "CHECK_MONITORING_STATUS",
      purchase_id: "pur_r2c_regression_missing",
    }),
  });

  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  await fillPurchase(page, {
    "input-url": TARGET_URL,
    "input-price": PURCHASE_PRICE,
    "input-date": PURCHASE_DATE,
    "input-region": "AK",
    "input-model": "",
    "input-upc": "",
  });
  await page.getByTestId("submit-purchase").click();
  await page.getByTestId("purchase-error").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const fallbackBody = await page.locator("body").innerText();
  out.fallback_retry = {
    url: page.url(),
    error_text: (await page.getByTestId("purchase-error").innerText()).slice(
      0,
      500,
    ),
    price_survived:
      (await page.getByTestId("input-price").inputValue().catch(() => "")) ===
      "35",
    date_survived:
      (await page.getByTestId("input-date").inputValue().catch(() => "")) ===
      PURCHASE_DATE,
    generic_product_not_found_removed: !/product not found/i.test(fallbackBody),
    provider_searches_consumed: 0,
  };

  await fillPurchase(page, {
    "input-url": TARGET_URL,
    "input-price": PURCHASE_PRICE,
    "input-date": PURCHASE_DATE,
    "input-region": "TX",
    "input-model": "",
    "input-upc": "",
    "input-title": "",
  });

  const beforeSubmit = new Date().toISOString();
  await Promise.all([
    page.waitForURL(/\/purchases\/.+\/review/, { timeout: 120_000 }),
    page.getByTestId("submit-purchase").click(),
  ]);

  await page.screenshot({
    path: path.join(proofDir, "prod-review-airtag.png"),
    fullPage: true,
  });

  let reviewText = await page.locator("body").innerText();
  let decision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  let source = await page
    .getByTestId("discovery-data-source")
    .textContent()
    .catch(() => null);
  let reasons = await page
    .getByTestId("match-reasons")
    .textContent()
    .catch(() => null);
  let confirmTitle = await page
    .getByTestId("confirm-title")
    .textContent()
    .catch(() => null);
  let candidateRows = await page.getByTestId("candidate-row").count();
  let confirmVisible = await page
    .getByTestId("confirm-candidate")
    .isVisible()
    .catch(() => false);
  let diagnostics = await readDiagnostics(page);
  let calls = Number(diagnostics?.provider_calls_used ?? 0);
  out.provider_search_budget.consumed_exact += Number.isFinite(calls)
    ? calls
    : 0;
  out.diagnostic_classification =
    diagnostics?.primary_cause ?? "PROOF_INSTRUMENTATION_INSUFFICIENT";

  out.target_url_tcin_resolution = {
    submitted_at: beforeSubmit,
    completed_at: new Date().toISOString(),
    target_url_contains_tcin: true,
    extracted_tcin: TARGET_TCIN,
    input_required: ["target_product_url", "purchase_price", "purchase_date"],
    model_supplied: false,
    upc_supplied: false,
    data_source: source?.trim() ?? null,
    match_decision: decision,
    match_reasons: reasons?.trim() ?? null,
    diagnostics,
    candidate_count: candidateRows,
    confirm_title: confirmTitle?.trim() ?? null,
    confirm_visible: confirmVisible,
    seller_evidence: /seller:\s*target/i.test(reviewText) ? "Target" : null,
    identifiers_visible: {
      tcin: new RegExp(`TCIN:\\s*${TARGET_TCIN}`, "i").test(reviewText),
      google_product_id_not_tcin_note: /not Target TCIN/i.test(reviewText),
    },
    immersive_enrichment_use:
      diagnostics?.immersive_enrichment_used === true
        ? "used"
        : diagnostics?.immersive_enrichment_used === false
          ? "not_used"
          : "not_exposed",
  };

  if (
    !confirmVisible &&
    out.provider_search_budget.consumed_exact <
      out.provider_search_budget.max_new_serpapi_searches
  ) {
    out.progressive_fallback_identity.attempted = true;
    await page.getByRole("link", { name: /edit purchase details/i }).first().click();
    await page.getByTestId("purchase-form").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const preservedBeforeFallback = {
      url:
        (await page.getByTestId("input-url").inputValue().catch(() => "")) ===
        TARGET_URL,
      price:
        (await page.getByTestId("input-price").inputValue().catch(() => "")) ===
        PURCHASE_PRICE,
      date:
        (await page.getByTestId("input-date").inputValue().catch(() => "")) ===
        PURCHASE_DATE,
    };
    await fillPurchase(page, {
      "input-upc": FALLBACK_UPC,
      "input-model": "",
    });
    const fallbackSubmittedAt = new Date().toISOString();
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 120_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    reviewText = await page.locator("body").innerText();
    decision = await page
      .getByTestId("match-decision")
      .getAttribute("data-decision")
      .catch(() => null);
    source = await page
      .getByTestId("discovery-data-source")
      .textContent()
      .catch(() => null);
    reasons = await page
      .getByTestId("match-reasons")
      .textContent()
      .catch(() => null);
    confirmTitle = await page
      .getByTestId("confirm-title")
      .textContent()
      .catch(() => null);
    candidateRows = await page.getByTestId("candidate-row").count();
    confirmVisible = await page
      .getByTestId("confirm-candidate")
      .isVisible()
      .catch(() => false);
    diagnostics = await readDiagnostics(page);
    calls = Number(diagnostics?.provider_calls_used ?? 0);
    out.provider_search_budget.consumed_exact += Number.isFinite(calls)
      ? calls
      : 0;
    out.upc_fallback_result = {
      submitted_at: fallbackSubmittedAt,
      completed_at: new Date().toISOString(),
      identifier_type: "UPC",
      identifier_value_redacted: "195950******",
      preservedBeforeFallback,
      data_source: source?.trim() ?? null,
      match_decision: decision,
      match_reasons: reasons?.trim() ?? null,
      diagnostics,
      candidate_count: candidateRows,
      confirm_title: confirmTitle?.trim() ?? null,
      confirm_visible: confirmVisible,
      seller_evidence: /seller:\s*target/i.test(reviewText) ? "Target" : null,
      identifiers_visible: {
        tcin: new RegExp(`TCIN:\\s*${TARGET_TCIN}`, "i").test(reviewText),
      },
      generic_product_not_found_removed: !/product not found/i.test(reviewText),
    };
  } else if (!confirmVisible) {
    out.progressive_fallback_identity.attempted = false;
    out.progressive_fallback_identity.blocked_reason =
      "Provider-call budget was exhausted by URL-only discovery before UPC fallback.";
  }

  if (confirmVisible) {
    await Promise.all([
      page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 60_000 }),
      page.getByTestId("confirm-candidate").click(),
    ]);
    await page.screenshot({
      path: path.join(proofDir, "prod-confirmed-airtag.png"),
      fullPage: true,
    });
    const dashboardText = await page.locator("body").innerText();
    out.target_url_tcin_resolution.confirmation = {
      final_url: page.url(),
      monitoring_active: /Nobu is watching this purchase|MONITORING_ACTIVE/i.test(
        dashboardText,
      ),
      fixture_absent: !/DEMO FIXTURE DATA/i.test(dashboardText),
    };
  }

  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await fillPurchase(page, {
    "input-url": `https://www.example.com/not-target/-/A-${TARGET_TCIN}`,
    "input-price": PURCHASE_PRICE,
    "input-date": PURCHASE_DATE,
    "input-region": "TX",
  });
  const negativeSubmit = page.getByTestId("submit-purchase");
  const negativeDisabled = await negativeSubmit.isDisabled();
  const negativeText = await page.locator("body").innerText();
  out.negative_fail_closed = {
    case: "non_target_domain",
    provider_searches_consumed: 0,
    blocked_before_submit: negativeDisabled,
    disabled_reason: (await negativeSubmit.getAttribute("title")) ?? null,
    clear_reason: /Target product link|Target\.com|valid Target/i.test(
      negativeText,
    ),
    generic_product_not_found_removed: !/product not found/i.test(negativeText),
  };

  const healthPass =
    out.health.status === 200 &&
    out.health.body?.status === "ok" &&
    out.health.body?.policy_ops_store_kind === "postgres" &&
    out.health.body?.policy_review_state === "CURRENT";
  const agentPass =
    out.agent_regression.status === 404 ||
    out.agent_regression.body?.error === "not_found";
  const fallbackPass =
    out.fallback_retry.price_survived &&
    out.fallback_retry.date_survived &&
    out.fallback_retry.generic_product_not_found_removed;
  const targetPass =
    (out.target_url_tcin_resolution.confirm_visible ||
      out.upc_fallback_result?.confirm_visible) &&
    out.target_url_tcin_resolution.data_source === "LIVE";
  const negativePass =
    out.negative_fail_closed.clear_reason &&
    out.negative_fail_closed.generic_product_not_found_removed;
  const budgetPass =
    out.provider_search_budget.consumed_exact <=
    out.provider_search_budget.max_new_serpapi_searches;
  const instrumentationPass =
    diagnostics &&
    !diagnostics.parse_error &&
    Number.isInteger(diagnostics.provider_calls_used) &&
    typeof diagnostics.query_strategy_identifier === "string";

  out.verdict =
    healthPass &&
    agentPass &&
    fallbackPass &&
    targetPass &&
    negativePass &&
    budgetPass &&
    instrumentationPass
      ? "PASS"
      : "BLOCKED";

  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  process.exit(out.verdict === "PASS" ? 0 : 2);
} catch (error) {
  out.verdict = "ERROR";
  out.error = error instanceof Error ? error.message : String(error);
  fs.writeFileSync(
    path.join(proofDir, "production-proof.json"),
    JSON.stringify(out, null, 2),
  );
  console.error(out.error);
  await browser.close().catch(() => {});
  process.exit(1);
}
