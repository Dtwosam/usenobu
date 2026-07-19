import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

const PROOF = path.join("docs", "proof", "lane-7-3a-1-adaptive", "screens");

test.describe("Lane 7.3A.1 adaptive product discovery", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
    try {
      fs.rmSync("data/nobu.e2e.sqlite", { force: true });
    } catch {
      // ignore
    }
  });

  test("no mode selector; button gating; multi-candidate selection flow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);

    // No identification-mode selector
    await expect(page.getByTestId("mode-exact")).toHaveCount(0);
    await expect(page.getByTestId("mode-find")).toHaveCount(0);
    await expect(
      page.getByText("How do you want to identify the product?"),
    ).toHaveCount(0);
    await expect(page.getByTestId("product-details-section")).toBeVisible();

    // Initially disabled without product clue
    await expect(page.getByTestId("submit-purchase")).toBeDisabled();
    await page.getByTestId("input-price").fill("99.99");
    await page.getByTestId("input-date").fill("2026-07-18");
    await page.getByTestId("input-region").fill("TX");
    await expect(page.getByTestId("submit-purchase")).toBeDisabled();
    await expect(page.getByTestId("find-product-hint")).toContainText(
      "Add at least one product detail",
    );

    // Whitespace-only does not enable
    await page.getByTestId("input-title").fill("   ");
    await expect(page.getByTestId("submit-purchase")).toBeDisabled();

    // Meaningful description enables
    await page.getByTestId("input-title").fill("Apple AirPods");
    await expect(page.getByTestId("submit-purchase")).toBeEnabled();

    await setFixtureScenario(page, "multi_candidate");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);

    await expect(page.getByTestId("multi-result-stage")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("multi-match-heading")).toContainText(
      "Which product did you purchase?",
    );
    const rows = page.getByTestId("candidate-row");
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);

    // No candidate preselected
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toHaveAttribute("data-selected", "false");
    }
    await expect(page.getByTestId("continue-selected")).toBeDisabled();
    await expect(page.getByTestId("confirm-candidate")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/confidence|match %/i);

    await page.screenshot({
      path: path.join(PROOF, "desktop-multi-unselected.png"),
      fullPage: true,
    });

    // Select first strong candidate
    await rows.first().click();
    await expect(rows.first()).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("candidate-selected-label")).toBeVisible();
    await expect(page.getByTestId("candidate-radio").first()).toBeChecked();
    await expect(page.getByTestId("continue-selected")).toBeEnabled();
    // Selection does not auto-confirm
    await expect(page.getByTestId("confirm-candidate")).toHaveCount(0);

    await page.screenshot({
      path: path.join(PROOF, "desktop-multi-selected.png"),
      fullPage: true,
    });

    await page.getByTestId("continue-selected").click();
    await expect(page.getByTestId("final-confirm-stage")).toBeVisible();
    await expect(page.getByTestId("final-confirm-heading")).toContainText(
      "Confirm your product",
    );
    await expect(page.getByTestId("confirm-candidate")).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/purchases\/[^/]+$/, { timeout: 45_000 }),
      page.getByTestId("confirm-candidate").click(),
    ]);

    await expect(page.getByTestId("status-code")).toHaveText("MONITORING_ACTIVE", {
      timeout: 15_000,
    });
  });

  test("mobile multi-candidate layout has no horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await page.getByTestId("input-title").fill("Apple AirPods");
    await page.getByTestId("input-price").fill("99.99");
    await page.getByTestId("input-date").fill("2026-07-18");
    await page.getByTestId("input-region").fill("TX");
    await setFixtureScenario(page, "multi_candidate");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    await expect(page.getByTestId("multi-result-stage")).toBeVisible({
      timeout: 15_000,
    });
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    await page.getByTestId("candidate-row").first().click();
    await expect(page.getByTestId("selection-sticky")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "mobile-multi-selected-sticky.png"),
      fullPage: true,
    });
  });

  test("exact fixture still reaches single confirmation path", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await setFixtureScenario(page, "exact_match");
    await page
      .getByTestId("input-url")
      .fill("https://www.target.com/p/example-widget/-/A-87654321");
    await page.getByTestId("input-tcin").fill("87654321");
    await page.getByTestId("input-model").fill("WDG-100");
    await page.getByTestId("input-price").fill("24.99");
    await page.getByTestId("input-date").fill("2026-07-18");
    await page.getByTestId("input-region").fill("TX");
    await page.getByTestId("input-title").fill("Example Widget Blue");
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    await expect(page.getByTestId("match-decision")).toHaveAttribute(
      "data-decision",
      "EXACT_MATCH_CANDIDATE",
    );
    await expect(page.getByTestId("confirm-candidate")).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({
      path: path.join(PROOF, "desktop-single-confirm.png"),
      fullPage: true,
    });
  });
});
