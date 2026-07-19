import { test, expect } from "@playwright/test";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

test.describe("Natural language AI intake (deterministic path)", () => {
  test("Fill details with AI populates form and requires Find my product", async ({
    page,
  }) => {
    await page.goto("/purchases/new");
    await expect(page.getByTestId("nl-intake-card")).toBeVisible();
    await page.getByTestId("input-purchase-text").fill(
      "I bought up&up acetaminophen from Target online yesterday for $9.99. https://www.target.com/p/acetaminophen/-/A-12345678 model UPUP-ACET-500",
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
    // AI does not auto-submit; complete exact identity then Find my product
    await expect(page.getByTestId("submit-purchase")).toBeVisible();
    await fillFixtureExactIdentity(page, {
      url: "https://www.target.com/p/example-widget/-/A-87654321",
      tcin: "87654321",
      model: "WDG-100",
      price: "8.50",
      date: "2026-07-05",
      region: "TX",
      title: "Example Widget Blue",
    });
    await expect(page.getByTestId("submit-purchase")).toBeEnabled();
    await setFixtureScenario(page, "exact_match");

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
    await openManualPurchaseForm(page);
    await setFixtureScenario(page, "exact_match");
    await fillFixtureExactIdentity(page);
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
  });
});
