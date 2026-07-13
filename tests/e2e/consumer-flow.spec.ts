import { test, expect } from "@playwright/test";
import fs from "node:fs";

test.describe("AfterBuy consumer web flow (fixture-labelled)", () => {
  test.beforeAll(() => {
    // Fresh DB for e2e process (webServer also sets path)
    try {
      fs.rmSync("data/afterbuy.e2e.sqlite", { force: true });
    } catch {
      // ignore
    }
  });

  test("add → review → confirm → monitor → alert path", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("home-fixture-notice")).toBeVisible();
    await page.getByTestId("cta-add-purchase").click();

    await expect(page.getByTestId("fixture-banner")).toContainText("demo fixtures");
    await page.getByTestId("input-scenario").selectOption("exact_match");
    await page.getByTestId("submit-purchase").click();

    await expect(page.getByTestId("match-decision")).toHaveText(
      "EXACT_MATCH_CANDIDATE",
    );
    await expect(page.getByTestId("fixture-banner")).toContainText(
      "DEMO FIXTURE DATA",
    );
    await page.getByTestId("confirm-candidate").click();

    await expect(page.getByTestId("status-pill")).toHaveText("MONITORING_ACTIVE");
    await expect(page.getByTestId("fingerprint-id")).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/alerts\//, { timeout: 30_000 }),
      page.getByTestId("run-check").click(),
    ]);

    await expect(page.getByTestId("alert-summary")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("potential-recovery")).toContainText(
      "Potential recovery",
    );
    await expect(page.getByTestId("alert-disclaimer")).toContainText(
      "does not guarantee a refund",
    );
    await expect(page.getByTestId("target-official-actions")).toContainText(
      "Guest Services",
    );
    await expect(page.getByTestId("fixture-banner")).toContainText(
      "DEMO FIXTURE DATA",
    );

    // Sensitive fields must not appear anywhere on alert page
    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).not.toContain("password");
    expect(body.toLowerCase()).not.toContain("card number");
    expect(body.toLowerCase()).not.toContain("cvv");
  });

  test("ambiguous fixture path cannot confirm", async ({ page }) => {
    await page.goto("/purchases/new");
    await page.getByTestId("input-scenario").selectOption("ambiguous");
    await page.getByTestId("input-url").fill(
      "https://www.target.com/p/acetaminophen-demo",
    );
    await page.getByTestId("input-tcin").fill("");
    await page.getByTestId("input-model").fill("UPUP-ACET-500");
    await page.getByTestId("submit-purchase").click();

    await expect(page.getByTestId("match-decision")).toHaveText(
      "MATCH_REVIEW_REQUIRED",
    );
    await expect(page.getByTestId("cannot-confirm")).toBeVisible();
    await expect(page.getByTestId("confirm-candidate")).toHaveCount(0);
  });

  test("no-price fixture path shows empty candidates", async ({ page }) => {
    await page.goto("/purchases/new");
    await page.getByTestId("input-scenario").selectOption("no_price");
    await page.getByTestId("submit-purchase").click();

    await expect(page.getByTestId("no-candidates")).toBeVisible();
    await expect(page.getByTestId("cannot-confirm")).toBeVisible();
  });

  test("unsupported region Alaska is blocked", async ({ page }) => {
    await page.goto("/purchases/new");
    await page.getByTestId("input-region").fill("AK");
    await page.getByTestId("submit-purchase").click();
    await expect(page.getByTestId("purchase-error")).toBeVisible();
    await expect(page.getByTestId("purchase-error")).toContainText(
      "unsupported_or_ineligible",
    );
  });

  test("notices page documents privacy and provenance", async ({ page }) => {
    await page.goto("/notices");
    await expect(page.getByTestId("privacy-notice")).toContainText("No Target passwords");
    await expect(page.getByTestId("provenance-notice")).toContainText("SerpApi");
    await expect(page.getByTestId("provenance-notice")).toContainText(
      "third-party",
    );
    await expect(page.getByTestId("supported-case-notice")).toContainText(
      "Target Plus",
    );
  });
});
