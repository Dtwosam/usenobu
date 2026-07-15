/**
 * Gate 2: Clean session vs synthetic stale demo-default session on public alias.
 * Post-repair expectations:
 *  - Clean AirTag → exact match OR truthful ambiguity without old "Add TCIN" copy
 *  - Pure demo defaults → outdated draft rejection (no old cannot-confirm copy)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/production-session-differential");
fs.mkdirSync(proofDir, { recursive: true });

const OLD =
  "We found more than one possible Target product. Add a model, TCIN or UPC so Nobu can avoid choosing the wrong item.";
const NEW =
  "Nobu found several different Target products and could not safely choose one.";
const OUTDATED =
  "Your saved draft was outdated. Please add the purchase again.";

const TEXT =
  "For testing, I bought an Apple AirTag from Target.com today for $35. The TCIN is 54191097, and the product link is https://www.target.com/p/apple-airtag/-/A-54191097.";

async function openManual(page) {
  const btn = page.getByTestId("btn-manual-entry");
  if (await btn.isVisible().catch(() => false)) {
    if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  }
  await page.getByTestId("purchase-form").waitFor({ state: "visible" });
}

async function runClean(page) {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await openManual(page);
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
  const form = {
    url: await page.getByTestId("input-url").inputValue(),
    tcin: await page.getByTestId("input-tcin").inputValue(),
    model: await page.getByTestId("input-model").inputValue(),
    title: await page.getByTestId("input-title").inputValue(),
  };
  await Promise.all([
    page.waitForURL(
      (u) =>
        u.pathname.includes("/review") ||
        u.searchParams.has("error") ||
        u.pathname.includes("/purchases/new"),
      { timeout: 120_000 },
    ),
    page.getByTestId("submit-purchase").click(),
  ]);
  const body = await page.locator("body").innerText();
  const decision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  const n = await page.getByTestId("candidate-row").count().catch(() => 0);
  const ambBody = await page
    .getByTestId("ambiguous-body")
    .textContent()
    .catch(() => null);
  const cannot = await page
    .getByTestId("cannot-confirm")
    .innerText()
    .catch(() => null);
  return {
    mode: "clean",
    final_url: page.url(),
    form,
    decision,
    candidate_count: n,
    ambiguous_body: ambBody?.trim() ?? null,
    cannot_confirm_text: cannot?.slice(0, 400) ?? null,
    old_copy_visible: body.includes(OLD),
    new_copy_visible: body.includes(NEW),
    outdated_copy_visible: body.includes(OUTDATED),
    is_404: /could not be found/i.test(body),
    identifiers_survived:
      form.tcin === "54191097" &&
      /54191097/.test(form.url) &&
      /airtag/i.test(form.title),
    pass:
      !body.includes(OLD) &&
      form.tcin === "54191097" &&
      !/could not be found/i.test(body) &&
      (decision === "EXACT_MATCH_CANDIDATE" ||
        (decision === "MATCH_REVIEW_REQUIRED" && body.includes(NEW))),
  };
}

async function runStaleDemo(page) {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await openManual(page);
  await page
    .getByTestId("input-url")
    .fill("https://www.target.com/p/example-widget/-/A-87654321");
  await page.getByTestId("input-tcin").fill("87654321");
  await page.getByTestId("input-model").fill("WDG-100");
  await page.getByTestId("input-title").fill("Example Widget Blue");
  await page.getByTestId("input-price").fill("24.99");
  await page
    .getByTestId("input-date")
    .fill(new Date().toISOString().slice(0, 10));
  await page.getByTestId("input-region").fill("TX");

  const formBefore = {
    url: await page.getByTestId("input-url").inputValue(),
    tcin: await page.getByTestId("input-tcin").inputValue(),
    model: await page.getByTestId("input-model").inputValue(),
    title: await page.getByTestId("input-title").inputValue(),
  };

  await Promise.all([
    page.waitForURL(
      (u) =>
        u.pathname.includes("/review") ||
        u.searchParams.has("error") ||
        u.pathname.includes("/purchases/new"),
      { timeout: 60_000 },
    ),
    page.getByTestId("submit-purchase").click(),
  ]);

  const body = await page.locator("body").innerText();
  const decision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  const formAfter = {
    url: await page
      .getByTestId("input-url")
      .inputValue()
      .catch(() => null),
    tcin: await page
      .getByTestId("input-tcin")
      .inputValue()
      .catch(() => null),
    title: await page
      .getByTestId("input-title")
      .inputValue()
      .catch(() => null),
  };
  return {
    mode: "stale_defaults",
    final_url: page.url(),
    form_before: formBefore,
    form_after: formAfter,
    decision,
    old_copy_visible: body.includes(OLD),
    new_copy_visible: body.includes(NEW),
    outdated_copy_visible: body.includes(OUTDATED),
    demo_not_on_review:
      !page.url().includes("/review") ||
      !/Example Widget|87654321/i.test(body),
    pass:
      !body.includes(OLD) &&
      (body.includes(OUTDATED) ||
        (page.url().includes("error=outdated_demo_draft") &&
          !page.url().includes("/review"))),
  };
}

/** Fresh AirTag after pre-filling demo (client AI clear + submit). */
async function runStaleThenAirTag(page) {
  await page.goto(`${base}/purchases/new`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await openManual(page);
  // Contaminate with demo
  await page
    .getByTestId("input-url")
    .fill("https://www.target.com/p/example-widget/-/A-87654321");
  await page.getByTestId("input-tcin").fill("87654321");
  await page.getByTestId("input-title").fill("Example Widget Blue");
  // Overwrite with explicit fresh AirTag (user correction path)
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
  const form = {
    url: await page.getByTestId("input-url").inputValue(),
    tcin: await page.getByTestId("input-tcin").inputValue(),
    title: await page.getByTestId("input-title").inputValue(),
  };
  await Promise.all([
    page.waitForURL(
      (u) => u.pathname.includes("/review") || u.searchParams.has("error"),
      { timeout: 120_000 },
    ),
    page.getByTestId("submit-purchase").click(),
  ]);
  const body = await page.locator("body").innerText();
  const decision = await page
    .getByTestId("match-decision")
    .getAttribute("data-decision")
    .catch(() => null);
  return {
    mode: "stale_then_fresh_airtag",
    final_url: page.url(),
    form,
    decision,
    old_copy_visible: body.includes(OLD),
    demo_contaminates:
      /87654321|Example Widget/i.test(body) && page.url().includes("/review"),
    pass:
      !body.includes(OLD) &&
      form.tcin === "54191097" &&
      !/87654321/.test(form.tcin) &&
      (decision === "EXACT_MATCH_CANDIDATE" ||
        decision === "MATCH_REVIEW_REQUIRED"),
  };
}

const browser = await chromium.launch();

const ctxA = await browser.newContext();
const pageA = await ctxA.newPage();
const clean = await runClean(pageA);
await pageA.screenshot({
  path: path.join(proofDir, "A-clean-session.png"),
  fullPage: true,
});
await ctxA.close();

const ctxB = await browser.newContext();
const pageB = await ctxB.newPage();
const stale = await runStaleDemo(pageB);
await pageB.screenshot({
  path: path.join(proofDir, "B-stale-session.png"),
  fullPage: true,
});
await ctxB.close();

const ctxC = await browser.newContext();
const pageC = await ctxC.newPage();
const migrated = await runStaleThenAirTag(pageC);
await pageC.screenshot({
  path: path.join(proofDir, "C-stale-then-fresh.png"),
  fullPage: true,
});
await ctxC.close();

await browser.close();

const out = {
  at: new Date().toISOString(),
  base,
  clean,
  stale,
  migrated,
  overall_pass: Boolean(clean.pass && stale.pass && migrated.pass),
  old_copy_string: OLD,
  new_copy_string: NEW,
};
fs.writeFileSync(
  path.join(proofDir, "gate2-sessions.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
process.exit(out.overall_pass ? 0 : 1);
