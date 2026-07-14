import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";

const SCREEN_DIR = path.join("docs", "proof", "ui", "screens");

test.describe("Nobu consumer web flow (fixture-labelled)", () => {
  test.beforeAll(() => {
    try {
      fs.rmSync("data/nobu.e2e.sqlite", { force: true });
    } catch {
      // ignore
    }
    fs.mkdirSync(SCREEN_DIR, { recursive: true });
  });

  test("homepage navigation and primary CTA", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Bought it/i })).toBeVisible();
    await expect(page.getByTestId("home-fixture-notice")).toContainText("Demo data");
    await expect(page.getByTestId("availability-label")).toContainText(
      "Currently supports eligible Target.com purchases",
    );
    await expect(page.getByTestId("cta-add-purchase")).toContainText(
      "Ask Nobu to watch a purchase",
    );
    await expect(page.getByTestId("cta-how-it-works")).toBeVisible();
    const home = (await page.locator("body").innerText()).toLowerCase();
    expect(home).not.toMatch(/walmart|amazon|best buy.*live|all retailers supported/);
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-home.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-home.png"),
      fullPage: true,
    });
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  });

  test("add → review → confirm → monitor → alert path", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await expect(page.getByTestId("home-fixture-notice")).toBeVisible();
    await page.getByTestId("cta-add-purchase").click();

    await expect(page.getByTestId("fixture-banner")).toContainText("Demo data");
    await expect(page.getByTestId("fixture-banner")).toContainText(
      "test fixtures",
    );
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-add-purchase.png"),
      fullPage: true,
    });

    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("exact_match");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);

    await expect(page.getByTestId("match-decision")).toHaveAttribute(
      "data-decision",
      "EXACT_MATCH_CANDIDATE",
    );
    await expect(page.getByTestId("match-decision")).toHaveText(
      "EXACT_MATCH_CANDIDATE",
    );
    await expect(page.getByTestId("fixture-banner")).toContainText(
      "DEMO FIXTURE DATA",
    );
    await expect(page.getByRole("heading", { name: /Confirm the exact product/i })).toBeVisible();
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-candidate-review.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-candidate-review.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await Promise.all([
      page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 45_000 }),
      page.getByTestId("confirm-candidate").click(),
    ]);

    await expect(page.getByTestId("status-pill")).toContainText(
      "Nobu is watching this purchase",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("status-code")).toHaveText("MONITORING_ACTIVE");
    await expect(page.getByTestId("fingerprint-id")).toBeAttached();
    await expect(page.getByTestId("monitoring-proof")).toBeVisible();
    await expect(page.getByTestId("proof-support")).toContainText(
      "exact product you confirmed",
    );
    await expect(page.getByTestId("run-check")).toContainText("Check price now");
    // Next check must not be invented
    await expect(page.getByTestId("next-check")).toHaveCount(0);
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-dashboard.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-dashboard.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await Promise.all([
      page.waitForURL(/\/alerts\//, { timeout: 30_000 }),
      page.getByTestId("run-check").click(),
    ]);

    await expect(page.getByTestId("alert-summary")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("heading", {
        name: /Nobu found a possible price difference|Price drop found/i,
      }),
    ).toBeVisible();
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
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-price-drop.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-price-drop.png"),
      fullPage: true,
    });

    const body = await page.locator("body").innerText();
    expect(body.toLowerCase()).not.toContain("password");
    expect(body.toLowerCase()).not.toContain("card number");
    expect(body.toLowerCase()).not.toContain("cvv");
    expect(body.toLowerCase()).not.toContain("guaranteed refund");
  });

  test("add-purchase validation preserves values and blocks AK", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-region").fill("AK");
    await page.getByTestId("input-price").fill("12.34");
    await page.getByTestId("submit-purchase").click();
    await expect(page.getByTestId("purchase-error")).toBeVisible();
    await expect(page.getByTestId("purchase-error")).toContainText(
      "isn’t supported yet",
    );
    await expect(page.getByTestId("purchase-error")).toContainText(
      "Target.com",
    );
    await expect(page.getByTestId("purchase-error-code")).toHaveText(
      "unsupported_or_ineligible",
    );
    await expect(page.getByTestId("input-price")).toHaveValue("12.34");
    await expect(page.getByTestId("input-region")).toHaveValue("AK");
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-error-unsupported.png"),
      fullPage: true,
    });
  });

  test("ambiguous fixture path cannot confirm", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("ambiguous");
    await page.getByTestId("input-url").fill(
      "https://www.target.com/p/acetaminophen-demo",
    );
    await page.getByTestId("input-tcin").fill("");
    await page.getByTestId("input-model").fill("UPUP-ACET-500");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);

    await expect(page.getByTestId("match-decision")).toHaveAttribute(
      "data-decision",
      "MATCH_REVIEW_REQUIRED",
    );
    await expect(page.getByTestId("cannot-confirm")).toBeVisible();
    await expect(page.getByTestId("cannot-confirm")).toContainText(
      "We need a little more detail",
    );
    await expect(page.getByTestId("confirm-candidate")).toHaveCount(0);
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-ambiguous.png"),
      fullPage: true,
    });
  });

  test("no-price fixture path shows empty candidates", async ({ page }) => {
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("no_price");
    await page.getByTestId("submit-purchase").click();

    await expect(page.getByTestId("no-candidates")).toBeVisible();
    await expect(page.getByTestId("cannot-confirm")).toBeVisible();
  });

  test("notices page documents privacy and provenance", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/notices");
    await expect(page.getByRole("heading", { name: /How Nobu works/i })).toBeVisible();
    await expect(page.getByTestId("platform-positioning")).toContainText(
      "retailer-specific monitoring integrations",
    );
    await expect(page.getByTestId("platform-positioning")).toContainText(
      "Target.com and Target app purchases only",
    );
    await expect(page.getByTestId("privacy-notice")).toContainText(
      "No Target passwords",
    );
    await expect(page.getByTestId("provenance-notice")).toContainText("SerpApi");
    await expect(page.getByTestId("provenance-notice")).toContainText(
      "third-party",
    );
    await expect(page.getByTestId("supported-case-notice")).toContainText(
      "Target Plus",
    );
    await page.screenshot({
      path: path.join(SCREEN_DIR, "desktop-notices.png"),
      fullPage: true,
    });
  });

  test("add-purchase shows Target as current retailer only", async ({ page }) => {
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await expect(page.getByRole("heading", { name: /Add your purchase/i })).toBeVisible();
    await expect(page.getByTestId("input-retailer")).toHaveValue(
      "Target — currently supported",
    );
    await expect(page.getByTestId("unsupported-retailer-note")).toContainText(
      "isn’t supported yet",
    );
    await expect(page.locator('select[name="retailer"]')).toHaveCount(0);
  });

  test("no sensitive input fields on purchase form", async ({ page }) => {
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[name*="card" i]')).toHaveCount(0);
    await expect(page.locator('input[name*="cvv" i]')).toHaveCount(0);
    await expect(page.locator('input[name*="bank" i]')).toHaveCount(0);
  });

  test("mobile add-purchase screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await page.screenshot({
      path: path.join(SCREEN_DIR, "mobile-add-purchase.png"),
      fullPage: true,
    });
  });
});
