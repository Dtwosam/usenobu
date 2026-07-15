import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";

const FINAL = path.join("docs", "proof", "ui", "final");

test.describe("Lane 7.5B3 final visual proof", () => {
  test.beforeAll(() => {
    fs.mkdirSync(FINAL, { recursive: true });
    try {
      fs.rmSync("data/nobu.e2e.sqlite", { force: true });
    } catch {
      // ignore
    }
  });

  test("header responsive: no desktop hamburger, no mobile header CTA clutter", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await expect(page.getByTestId("nav-add")).toBeVisible();
    await expect(page.getByTestId("nav-menu-toggle")).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("nav-menu-toggle")).toBeVisible();
    await expect(page.getByTestId("nav-add")).toBeHidden();
  });

  test("capture final screenshots + a11y + overflow + console", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    // Desktop homepage
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await page.screenshot({
      path: path.join(FINAL, "desktop-home.png"),
      fullPage: true,
    });

    // Mobile homepage
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.screenshot({
      path: path.join(FINAL, "mobile-home.png"),
      fullPage: true,
    });

    // Overflow at 320
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    let overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);

    // Add purchase desktop + mobile
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/purchases/new");
    await page.screenshot({
      path: path.join(FINAL, "desktop-add-purchase.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await page.screenshot({
      path: path.join(FINAL, "mobile-add-purchase.png"),
      fullPage: true,
    });

    // Flow: exact match → review → dashboard → alert
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("exact_match");
    const { fillFixtureExactIdentity } = await import(
      "./helpers/fill-fixture-identity"
    );
    await fillFixtureExactIdentity(page);
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    await expect(page.getByTestId("match-decision-label")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("match-decision")).toHaveAttribute(
      "data-decision",
      "EXACT_MATCH_CANDIDATE",
    );
    // Raw enum not visible as primary pill text in layout
    await expect(page.locator(".pill.warn")).toHaveCount(0);
    await page.screenshot({
      path: path.join(FINAL, "desktop-candidate-review.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(FINAL, "mobile-candidate-review.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("confirm-candidate").click();
    await expect(page.getByTestId("status-pill")).toContainText(
      "Nobu is watching this purchase",
    );
    await page.screenshot({
      path: path.join(FINAL, "desktop-dashboard.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(FINAL, "mobile-dashboard.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await Promise.all([
      page.waitForURL(/\/alerts\//, { timeout: 30_000 }),
      page.getByTestId("run-check").click(),
    ]);
    await expect(
      page.getByRole("heading", {
        name: /Possible price difference|Nobu found a possible price difference|Price drop found/i,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(FINAL, "desktop-price-drop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(FINAL, "mobile-price-drop.png"),
      fullPage: true,
    });

    // Notices
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/notices");
    await page.screenshot({
      path: path.join(FINAL, "desktop-notices.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/notices");
    await page.screenshot({
      path: path.join(FINAL, "mobile-notices.png"),
      fullPage: true,
    });

    // Ambiguous (same fixture inputs as consumer-flow)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("ambiguous");
    {
      const { fillFixtureExactIdentity } = await import(
        "./helpers/fill-fixture-identity"
      );
      await fillFixtureExactIdentity(page, {
        url: "https://www.target.com/p/acetaminophen-demo/-/A-12345678",
        tcin: "12345678",
        model: "UPUP-ACET-500",
        title: "up&up Acetaminophen",
      });
    }
    await page.getByTestId("submit-purchase").click();
    await expect(page.getByTestId("cannot-confirm")).toContainText(
      "We need a little more detail",
    );
    await page.screenshot({
      path: path.join(FINAL, "mobile-ambiguous.png"),
      fullPage: true,
    });

    // Unsupported error
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    {
      const { fillFixtureExactIdentity } = await import(
        "./helpers/fill-fixture-identity"
      );
      await fillFixtureExactIdentity(page, { region: "AK" });
    }
    await page.getByTestId("submit-purchase").click();
    await expect(page.getByTestId("purchase-error")).toBeVisible();
    await page.screenshot({
      path: path.join(FINAL, "mobile-error-unsupported.png"),
      fullPage: true,
    });

    // Axe key routes
    const routes = ["/", "/purchases/new", "/notices", "/dashboard"] as const;
    const axeSummary: Record<string, unknown> = {};
    for (const route of routes) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route);
      overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw, `overflow ${route}`).toBeLessThanOrEqual(
        overflow.cw + 1,
      );
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      axeSummary[route] = {
        seriousOrCritical: blocking.length,
        violations: results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.length,
        })),
        passes: results.passes.length,
      };
      expect(blocking, `${route}: ${JSON.stringify(blocking)}`).toEqual([]);
    }
    fs.writeFileSync(
      path.join(FINAL, "axe-final-summary.json"),
      JSON.stringify(axeSummary, null, 2),
      "utf8",
    );

    // Soft console check — ignore Next.js dev noise if any
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes("Download the React DevTools") &&
        !e.includes("Fast Refresh") &&
        !e.includes("hydration"),
    );
    fs.writeFileSync(
      path.join(FINAL, "console-errors.json"),
      JSON.stringify({ errors: realErrors }, null, 2),
      "utf8",
    );
    expect(realErrors, realErrors.join("\n")).toEqual([]);
  });

  test("broken-link sample on notices + home", async ({ page }) => {
    await page.goto("/");
    const links = await page.locator("a[href]").evaluateAll((as) =>
      as
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") || "")
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    for (const href of [...new Set(links)].slice(0, 12)) {
      const res = await page.request.get(href);
      expect(res.status(), href).toBeLessThan(400);
    }
  });
});
