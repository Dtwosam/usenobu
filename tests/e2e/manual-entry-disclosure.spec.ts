import { test, expect } from "@playwright/test";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

test.describe("Add purchase manual-entry disclosure", () => {
  test("manual form hidden initially; button toggles and preserves values", async ({
    page,
  }) => {
    await page.goto("/purchases/new");
    await expect(page.getByTestId("nl-intake-card")).toBeVisible();
    await expect(page.getByTestId("input-purchase-text")).toBeVisible();
    await expect(page.getByTestId("btn-fill-ai")).toBeVisible();

    const toggle = page.getByTestId("btn-manual-entry");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute("type", "button");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "purchase-manual-form");
    await expect(toggle).toHaveText("Enter details manually");
    await expect(page.getByTestId("purchase-form")).toHaveCount(0);

    // Mouse open
    await toggle.click();
    await expect(page.getByTestId("purchase-form")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("Hide manual form");
    await expect(page.locator("#target_product_url")).toBeFocused();

    await page.getByTestId("input-price").fill("12.34");
    await page.getByTestId("input-title").fill("Keep me");

    // Collapse without clearing
    await toggle.click();
    await expect(page.getByTestId("purchase-form")).toHaveCount(0);
    await expect(toggle).toHaveText("Enter details manually");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();
    await expect(page.getByTestId("input-price")).toHaveValue("12.34");
    await expect(page.getByTestId("input-title")).toHaveValue("Keep me");
  });

  test("keyboard Enter and Space open manual form", async ({ page }) => {
    await page.goto("/purchases/new");
    const toggle = page.getByTestId("btn-manual-entry");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("purchase-form")).toBeVisible();

    await toggle.click(); // hide
    await expect(page.getByTestId("purchase-form")).toHaveCount(0);

    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("purchase-form")).toBeVisible();
  });

  test("AI success expands form; Find my product reaches review", async ({
    page,
  }) => {
    await page.goto("/purchases/new");
    await page.getByTestId("input-purchase-text").fill(
      "I bought up&up acetaminophen from Target online yesterday for $9.99. https://www.target.com/p/acetaminophen/-/A-12345678",
    );
    await page.getByTestId("btn-fill-ai").click();
    await expect(page.getByTestId("ai-confirmation-gate")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("purchase-form")).toBeVisible();
    await expect(page.getByTestId("btn-manual-entry")).toHaveText(
      "Hide manual form",
    );

    await page
      .getByTestId("input-url")
      .fill("https://www.target.com/p/example-widget/-/A-87654321");
    await page.getByTestId("input-tcin").fill("87654321");
    await page.getByTestId("input-model").fill("WDG-100");
    await page.getByTestId("input-title").fill("Example Widget Blue");
    await page.getByTestId("input-date").fill("2026-07-05");
    await page.getByTestId("input-region").fill("TX");
    await page.getByTestId("input-price").fill("8.50");
    await setFixtureScenario(page, "exact_match");

    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    await expect(
      page.getByRole("heading", { name: /Confirm the exact product/i }),
    ).toBeVisible();
  });

  test("no horizontal overflow at 320 and 390 on add purchase", async ({
    page,
  }) => {
    for (const width of [320, 390] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/purchases/new");
      await openManualPurchaseForm(page);
      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    }
  });
});
