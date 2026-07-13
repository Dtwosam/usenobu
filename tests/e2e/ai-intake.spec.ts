import { test, expect } from "@playwright/test";

test.describe("Natural language AI intake (deterministic path)", () => {
  test("Fill details with AI populates form and requires Find my product", async ({
    page,
  }) => {
    await page.goto("/purchases/new");
    await expect(page.getByTestId("nl-intake-card")).toBeVisible();
    await page.getByTestId("input-purchase-text").fill(
      "I bought up&up acetaminophen from Target online yesterday for $9.99. https://www.target.com/p/acetaminophen/-/A-12345678",
    );
    await page.getByTestId("btn-fill-ai").click();
    await expect(page.getByTestId("ai-confirmation-gate")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("ai-confirmation-gate")).toContainText(
      "Here’s what I understood",
    );
    await expect(page.getByTestId("input-price")).not.toHaveValue("");
    await expect(page.getByTestId("input-url")).toHaveValue(/target\.com/);
    // Must still use Find my product — AI does not auto-submit
    await expect(page.getByTestId("submit-purchase")).toBeVisible();
    await expect(page.getByTestId("submit-purchase")).toBeEnabled();
    await page.getByTestId("input-price").fill("8.50");
    // Keep demo defaults stable for fixture matching after AI overwrite
    await page
      .getByTestId("input-url")
      .fill("https://www.target.com/p/example-widget/-/A-87654321");
    await page.getByTestId("input-tcin").fill("87654321");
    await page.getByTestId("input-model").fill("WDG-100");
    await page.getByTestId("input-title").fill("Example Widget Blue");
    await page.getByTestId("input-date").fill("2026-07-05");
    await page.getByTestId("input-region").fill("TX");
    await page.getByTestId("input-scenario").selectOption("exact_match");

    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    await expect(
      page.getByRole("heading", { name: /Confirm the exact product/i }),
    ).toBeVisible();
  });

  test("manual entry still works without AI", async ({ page }) => {
    await page.goto("/purchases/new");
    await page.getByTestId("btn-manual-entry").click();
    await page.getByTestId("input-scenario").selectOption("exact_match");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
  });
});
