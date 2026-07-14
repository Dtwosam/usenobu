import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const PROOF = path.join("docs", "proof", "ui", "judge-clarity");

test.describe("Homepage judge clarity (Sprint C)", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  test("hero, money-back benefit, availability, and intake path", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const title = page.getByRole("heading", {
      name: /Nobu watches prices after you buy/i,
    });
    await expect(title).toBeVisible();
    await expect(page.getByTestId("hero-lead")).toContainText(
      "request the difference back",
    );

    const heroText = (await page.locator(".n-hero").innerText()).toLowerCase();
    expect(heroText).not.toContain("target");
    expect(heroText).not.toMatch(/guaranteed|automatic refund|target owes/);

    await expect(page.getByTestId("home-steps")).toBeVisible();
    await expect(page.getByTestId("current-availability")).toContainText(
      "Eligible Target.com purchases",
    );
    await expect(page.getByTestId("availability-support")).toContainText(
      "starting with eligible Target.com",
    );
    await expect(page.getByTestId("home-trust")).toContainText(
      "third-party observation",
    );

    // No fake social proof
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/testimonial|users saved|\$\d+ recovered|coming soon/);
    expect(body).not.toContain("home-example-card");

    await page.screenshot({
      path: path.join(PROOF, "desktop-home.png"),
      fullPage: true,
    });

    // Primary CTA enters real journey
    await page.getByTestId("cta-add-purchase").click();
    await expect(page).toHaveURL(/\/purchases\/new/);
    await expect(page.getByTestId("nl-intake-card")).toBeVisible();
  });

  test("mobile 320 and 390 overflow", async ({ page }) => {
    for (const width of [390, 320] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw, `overflow at ${width}`).toBeLessThanOrEqual(
        overflow.cw + 1,
      );
      await page.screenshot({
        path: path.join(PROOF, `mobile-home-${width}.png`),
        fullPage: true,
      });
    }
  });

  test("axe on homepage", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    fs.writeFileSync(
      path.join(PROOF, "axe-home.json"),
      JSON.stringify(
        {
          violations: results.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.length,
          })),
        },
        null,
        2,
      ),
    );
    expect(blocking).toEqual([]);
  });

  test("how it works anchor scrolls to steps", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("cta-how-it-works").click();
    await expect(page.locator("#how-it-works")).toBeVisible();
  });
});
