/**
 * Lane 7.3A.2B — Active / History / Archived + outcome + archive UI.
 * Uses fixture mode + signed-in account via test magic link.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

const PROOF = path.join("docs", "proof", "lane-7-3a-2b-lifecycle", "screens");

async function fillSignInEmail(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await expect(page.getByTestId("sign-in-form")).toBeVisible();
  const input = page.getByTestId("sign-in-email");
  await input.click();
  await input.fill("");
  await page.keyboard.type(email, { delay: 15 });
  await expect(page.getByTestId("sign-in-submit")).toBeEnabled();
}

async function signInTest(page: Page, email: string) {
  await fillSignInEmail(page, email);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in-sent")).toBeVisible();
  const tokenRes = await page.request.post("/api/test/last-auth-token", {
    data: { email },
  });
  expect(tokenRes.ok()).toBeTruthy();
  const { token } = (await tokenRes.json()) as { token: string };
  await page.goto(`/auth/verify?token=${encodeURIComponent(token)}`);
  await page.getByTestId("verify-continue").click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
}

test.describe("purchase lifecycle UI", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  test("tabs, outcome, archive, restore, delete, mobile", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Sign in first so purchase is account-owned and durable
    await signInTest(page, "lifecycle-e2e@example.com");

    // Create purchase as account
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await setFixtureScenario(page, "exact_match");
    await fillFixtureExactIdentity(page, { title: "Lifecycle E2E Widget" });
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);

    await page.goto("/dashboard");
    await expect(page.getByTestId("purchase-tabs")).toBeVisible();
    await expect(page.getByTestId("tab-active")).toBeVisible();
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);
    await page.screenshot({
      path: path.join(PROOF, "desktop-active-tab.png"),
      fullPage: true,
    });

    // Outcome entry
    await page.getByTestId("purchase-menu").click();
    await page.getByTestId("menu-outcome").click();
    await expect(page.getByTestId("outcome-modal")).toBeVisible();
    await page.getByTestId("outcome-requested_waiting").check();
    await page.getByTestId("save-outcome").click();
    await page.waitForURL(/outcome_saved=1/);
    await expect(page.getByTestId("outcome-saved")).toBeVisible();
    await expect(page.getByTestId("user-outcome")).toContainText("waiting");

    // Archive
    await page.getByTestId("purchase-menu").click();
    await page.getByTestId("menu-archive").click();
    await page.waitForURL(/tab=archived/);
    await page.getByTestId("tab-archived").click();
    await expect(page.getByTestId("tab-archived")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);
    await page.screenshot({
      path: path.join(PROOF, "desktop-archived-tab.png"),
      fullPage: true,
    });

    // Refresh persistence
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("tab-archived").click();
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);

    // Restore
    await page.getByTestId("purchase-menu").click();
    await page.getByTestId("menu-restore").click();
    await page.waitForURL(/tab=active/);
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);

    // History tab empty or without this active item
    await page.getByTestId("tab-history").click();
    // Active purchase should not appear in history
    const historyRows = page.getByTestId("purchase-row");
    const historyText = (await historyRows.count())
      ? await historyRows.first().innerText()
      : "";
    expect(historyText).not.toMatch(/Lifecycle E2E Widget/i);

    // Delete confirmation
    await page.getByTestId("tab-active").click();
    await page.getByTestId("purchase-menu").click();
    await page.getByTestId("menu-delete").click();
    await expect(page.getByTestId("delete-modal")).toBeVisible();
    await expect(page.getByText("Delete this purchase?")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "desktop-delete-modal.png"),
      fullPage: true,
    });
    await page.getByTestId("confirm-delete").click();
    await page.waitForURL(/deleted=1/);
    await expect(page.getByTestId("deleted-status")).toBeVisible();

    // Mobile 390
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("purchase-tabs")).toBeVisible();
    const overflow = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
    await page.screenshot({
      path: path.join(PROOF, "mobile-tabs.png"),
      fullPage: true,
    });
  });
});
