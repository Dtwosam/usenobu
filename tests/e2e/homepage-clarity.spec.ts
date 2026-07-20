import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const PROOF = path.join("docs", "proof", "lane-8r-1-public-interface");

test.describe("Lane 8R.1 public website", () => {
  test.beforeAll(() => {
    fs.mkdirSync(path.join(PROOF, "screenshots"), { recursive: true });
  });

  test("homepage five sections, CTAs, no forbidden language", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(
      page.getByRole("heading", {
        name: /Don’t miss a price drop after you buy/i,
      }),
    ).toBeVisible();
    await expect(page.getByTestId("hero-lead")).toContainText(
      "opportunity to request the difference",
    );
    await expect(page.getByTestId("home-steps")).toBeVisible();
    await expect(page.getByTestId("home-scenario")).toContainText(
      "Possible price difference",
    );
    await expect(page.getByTestId("scenario-difference")).toHaveText("$20.00");
    await expect(page.getByTestId("home-access")).toBeVisible();
    await expect(page.getByTestId("home-trust")).toBeVisible();
    await expect(page.getByTestId("current-availability")).toContainText(
      "Target.com",
    );
    await expect(page.getByTestId("retailer-availability-sentence")).toContainText(
      "Target is the only retailer currently supported",
    );
    await expect(page.getByTestId("retailer-availability-sentence")).toContainText(
      "More retailers are planned for the future",
    );

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(
      /hackathon|judge|competition|submission|guaranteed savings|automatic refund|recover your money|make money with nobu/,
    );
    expect(body).not.toMatch(/testimonial|users saved|\$\d+ recovered/);

    // At most five primary section headings on the home screen
    const sectionHeadings = page.locator(
      ".n-screen--home > section h1, .n-screen--home > section h2",
    );
    await expect(sectionHeadings).toHaveCount(5);

    await page.screenshot({
      path: path.join(PROOF, "screenshots", "desktop-home.png"),
      fullPage: true,
    });

    await page.getByTestId("cta-add-purchase").click();
    await expect(page).toHaveURL(/\/purchases\/new/);
    await expect(page.getByTestId("nl-intake-card")).toBeVisible();
    await expect(page.getByTestId("exact-product-help")).toContainText(
      "exact product",
    );
  });

  test("OKX guide page and marketplace CTA fallback", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/okx");
    await expect(
      page.getByRole("heading", { name: /Use Nobu with OKX\.AI/i }),
    ).toBeVisible();
    await expect(page.getByTestId("okx-payment-copy")).toContainText(
      "does not guarantee",
    );
    await expect(page.getByTestId("okx-setup")).toBeVisible();
    await expect(page.getByTestId("okx-faq")).toBeVisible();
    await expect(page.getByTestId("okx-resources")).toBeVisible();

    // Default fallback: CTA points to /okx (no marketplace URL configured)
    const cta = page.getByTestId("cta-okx-marketplace").first();
    await expect(cta).toHaveAttribute("href", "/okx");

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(
      /hackathon|judge|competition|coming soon|pending approval/,
    );

    await page.screenshot({
      path: path.join(PROOF, "screenshots", "desktop-okx.png"),
      fullPage: true,
    });
  });

  test("notices page truth boundary", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/notices");
    await expect(page.getByTestId("okx-payment-notice-copy")).toContainText(
      "$0.99",
    );
    await expect(page.getByTestId("target-action-notice")).toContainText(
      "does not contact Target",
    );
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/hackathon|judge|guaranteed savings/);
    await page.screenshot({
      path: path.join(PROOF, "screenshots", "desktop-notices.png"),
      fullPage: true,
    });
  });

  test("mobile 320 and 390 no horizontal overflow", async ({ page }) => {
    for (const width of [390, 320] as const) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ["/", "/okx", "/notices", "/purchases/new"] as const) {
        await page.goto(route);
        const overflow = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          cw: document.documentElement.clientWidth,
        }));
        expect(
          overflow.sw,
          `overflow at ${width} on ${route}`,
        ).toBeLessThanOrEqual(overflow.cw + 1);
      }
      await page.goto("/");
      await page.screenshot({
        path: path.join(PROOF, "screenshots", `mobile-home-${width}.png`),
        fullPage: true,
      });
      await page.goto("/okx");
      await page.screenshot({
        path: path.join(PROOF, "screenshots", `mobile-okx-${width}.png`),
        fullPage: true,
      });
    }
  });

  test("axe on homepage and okx", async ({ page }) => {
    for (const route of ["/", "/okx"] as const) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      fs.writeFileSync(
        path.join(PROOF, `axe-${route === "/" ? "home" : "okx"}.json`),
        JSON.stringify(
          {
            route,
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
      expect(blocking, `axe blocking on ${route}`).toEqual([]);
    }
  });
});
