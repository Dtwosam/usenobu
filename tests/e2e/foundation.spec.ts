import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const PROOF_DIR = path.join("docs", "proof", "ui", "foundation");

test.describe("Nobu design foundation (Lane 7.5B1)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF_DIR, { recursive: true });
  });

  test("shell landmarks, primary CTA, and foundation gallery", async ({
    page,
  }) => {
    await page.goto("/design/foundation");
    await expect(page.getByTestId("foundation-gallery")).toBeVisible();
    await expect(page.getByTestId("app-header")).toBeVisible();
    await expect(page.getByTestId("app-footer")).toBeVisible();
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeAttached();
    await expect(page.getByTestId("nav-add")).toContainText("Track a purchase");
    await expect(page.getByTestId("token-swatches")).toBeVisible();
    await expect(page.getByTestId("foundation-demo-banner")).toContainText(
      "Demo data",
    );
    await expect(page.getByTestId("foundation-form-error")).toContainText(
      "try again",
    );

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("guaranteed refund");
    expect(body).toContain("does not guarantee a refund");
  });

  test("keyboard: skip link and focusable controls", async ({ page }) => {
    await page.goto("/design/foundation");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("no horizontal overflow at 320 and 390", async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/design/foundation");
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          scrollWidth: doc.scrollWidth,
          clientWidth: doc.clientWidth,
        };
      });
      expect(
        overflow.scrollWidth,
        `overflow at ${width}px`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });

  test("desktop and mobile foundation screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/design/foundation");
    await page.screenshot({
      path: path.join(PROOF_DIR, "foundation-desktop.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/design/foundation");
    await page.screenshot({
      path: path.join(PROOF_DIR, "foundation-mobile.png"),
      fullPage: true,
    });

    // Component state strip (top of gallery)
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/design/foundation");
    await page.locator("#buttons-heading").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(PROOF_DIR, "foundation-component-states.png"),
      fullPage: false,
    });

    expect(fs.existsSync(path.join(PROOF_DIR, "foundation-desktop.png"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(PROOF_DIR, "foundation-mobile.png"))).toBe(
      true,
    );
  });

  test("axe accessibility scan on foundation gallery", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/design/foundation");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const summary = {
      url: "/design/foundation",
      violations: results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        nodes: v.nodes.length,
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    };
    fs.writeFileSync(
      path.join(PROOF_DIR, "axe-foundation.json"),
      JSON.stringify(summary, null, 2),
      "utf8",
    );

    // Fail on serious/critical only; document all in proof file
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test("home shell still exposes E2E entry points", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("cta-add-purchase")).toBeVisible();
    await expect(page.getByTestId("home-fixture-notice")).toBeVisible();
    await expect(page.getByTestId("app-header")).toBeVisible();
  });
});
