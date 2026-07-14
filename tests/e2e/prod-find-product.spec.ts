/**
 * Production browser verification for Find my product repair (Lane 7.5D.1).
 * Skipped unless RUN_PROD_BROWSER=1 (requires live deploy).
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";

const PROD = process.env.PROD_BASE_URL ?? "https://usenobu.vercel.app";
const PROOF = path.join(
  "docs",
  "proof",
  "usenobu-production",
  "find-product-repair",
);
const runProd = process.env.RUN_PROD_BROWSER === "1";

test.describe("Production Find my product flow", () => {
  test.skip(!runProd, "Set RUN_PROD_BROWSER=1 to run against live UseNobu");

  test("valid submission reaches candidate review without application error", async () => {
    fs.mkdirSync(PROOF, { recursive: true });
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto(`${PROD}/`);
    await page.getByTestId("cta-add-purchase").click();
    await expect(page).toHaveURL(/\/purchases\/new/);

    await page.screenshot({
      path: path.join(PROOF, "01-form-before-submit.png"),
      fullPage: true,
    });

    await openManualPurchaseForm(page);
    await page.getByTestId("input-scenario").selectOption("exact_match");
    await page.getByTestId("submit-purchase").click();

    // Must not land on application-error page
    await expect(page.locator("body")).not.toContainText(
      "Application error",
      { timeout: 45_000 },
    );
    await expect(page.locator("body")).not.toContainText(
      "server-side exception",
    );

    // Review screen
    await expect(page).toHaveURL(/\/purchases\/.+\/review/, {
      timeout: 45_000,
    });
    await expect(
      page.getByRole("heading", { name: /Confirm the exact product/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("match-decision")).toHaveAttribute(
      "data-decision",
      "EXACT_MATCH_CANDIDATE",
    );

    await page.screenshot({
      path: path.join(PROOF, "02-review-after-submit.png"),
      fullPage: true,
    });

    const material = consoleErrors.filter(
      (e) =>
        !e.includes("Download the React DevTools") &&
        !e.includes("favicon") &&
        !e.includes("hydration"),
    );
    fs.writeFileSync(
      path.join(PROOF, "browser-console.json"),
      JSON.stringify({ errors: material }, null, 2),
      "utf8",
    );
    expect(material, material.join("\n")).toEqual([]);

    await browser.close();
  });

  test("unsupported AK returns form error not blank page", async () => {
    test.skip(!runProd, "prod only");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`${PROD}/purchases/new`);
    await openManualPurchaseForm(page);
    await page.getByTestId("input-region").fill("AK");
    await page.getByTestId("submit-purchase").click();
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByTestId("purchase-error")).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({
      path: path.join(PROOF, "03-unsupported-ak.png"),
      fullPage: true,
    });
    await browser.close();
  });
});
