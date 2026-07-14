/**
 * Sprint C — production homepage judge-clarity proof.
 */
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.NOBU_PROOF_BASE || "https://usenobu.vercel.app";
const proofDir = path.resolve("docs/proof/ui/judge-clarity");
fs.mkdirSync(proofDir, { recursive: true });

const out = {
  at: new Date().toISOString(),
  base,
  sprint: "C",
  checks: {},
};

const healthRes = await fetch(`${base}/health`);
out.checks.health = { status: healthRes.status, body: await healthRes.json() };

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
  ok: agentRes.status === 404,
};

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 60_000 });

const title = await page.getByRole("heading", { level: 1 }).innerText();
const lead = await page.getByTestId("hero-lead").innerText();
const hero = await page.locator(".n-hero").innerText();

out.checks.homepage = {
  title,
  lead,
  hero_has_target: /target/i.test(hero),
  money_back: /request the difference back/i.test(lead),
  cta: (await page.getByTestId("cta-add-purchase").innerText()).trim(),
  how_it_works: (await page.getByTestId("cta-how-it-works").innerText()).trim(),
  availability: (
    await page.getByTestId("current-availability").innerText()
  ).includes("Eligible Target.com"),
};

const body = (await page.locator("body").innerText()).toLowerCase();
out.checks.no_guarantee = !/guaranteed refund|target owes you|automatic refund|you will get the difference back/.test(
  body,
);
out.checks.no_fake_social = !/testimonial|users saved|coming soon: walmart/.test(
  body,
);

await page.screenshot({
  path: path.join(proofDir, "prod-desktop-home.png"),
  fullPage: true,
});

await page.getByTestId("cta-add-purchase").click();
await page.waitForURL(/\/purchases\/new/, { timeout: 30_000 });
out.checks.cta_to_intake = page.url().includes("/purchases/new");

await page.goto(`${base}/`, { waitUntil: "networkidle" });
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 800 });
  await page.reload({ waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  out.checks[`mobile_${width}`] = {
    ...overflow,
    ok: overflow.sw <= overflow.cw + 1,
  };
  await page.screenshot({
    path: path.join(proofDir, `prod-mobile-home-${width}.png`),
    fullPage: true,
  });
}

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${base}/`, { waitUntil: "networkidle" });
const axe = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa"])
  .analyze();
const blocking = axe.violations.filter(
  (v) => v.impact === "critical" || v.impact === "serious",
);
out.checks.a11y = {
  pass: blocking.length === 0,
  blocking: blocking.map((v) => ({ id: v.id, impact: v.impact })),
};
fs.writeFileSync(
  path.join(proofDir, "prod-axe-home.json"),
  JSON.stringify(
    {
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.length,
      })),
    },
    null,
    2,
  ),
);

const pass =
  out.checks.health.status === 200 &&
  out.checks.agent.ok &&
  /Nobu watches prices after you buy/i.test(out.checks.homepage.title) &&
  out.checks.homepage.money_back &&
  !out.checks.homepage.hero_has_target &&
  out.checks.homepage.cta === "Add a purchase" &&
  out.checks.homepage.availability &&
  out.checks.no_guarantee &&
  out.checks.no_fake_social &&
  out.checks.cta_to_intake &&
  out.checks.mobile_390.ok &&
  out.checks.mobile_320.ok &&
  out.checks.a11y.pass;

out.verdict = pass
  ? "NOBU_REVIEW_SAFE_C_PASS"
  : "NOBU_REVIEW_SAFE_C_BLOCKED";
out.user_testing = {
  status: "READY_FOR_REAL_TESTERS",
  real_testers_completed: 0,
  fabricated: false,
};

fs.writeFileSync(
  path.join(proofDir, "prod-proof.json"),
  JSON.stringify(out, null, 2),
);
console.log(JSON.stringify(out, null, 2));
await browser.close();
if (!pass) process.exit(1);
