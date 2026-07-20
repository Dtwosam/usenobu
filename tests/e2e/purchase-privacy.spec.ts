/**
 * Lane 7.3A.2A — My Purchases is account-private; Demo data absent on list.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

async function createOwnedPurchase(page: Page): Promise<string> {
  await page.goto("/purchases/new");
  await openManualPurchaseForm(page);
  await setFixtureScenario(page, "exact_match");
  await fillFixtureExactIdentity(page, {
    title: "Privacy Isolation Widget",
    tcin: "87654321",
  });
  await Promise.all([
    page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
    page.getByTestId("submit-purchase").click(),
  ]);
  const url = page.url();
  const match = url.match(/\/purchases\/(pur_[a-zA-Z0-9]+)/);
  const id = match?.[1];
  expect(id).toBeTruthy();
  if (!id) throw new Error("purchase id missing from review URL");
  return id;
}

test.describe("purchase privacy (two users)", () => {
  test("user A owns purchase; user B cannot see or open it", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // 1. User A creates and sees their purchase
      const purchaseId = await createOwnedPurchase(pageA);
      await pageA.goto("/dashboard");
      await expect(pageA.getByTestId("privacy-reassurance")).toContainText(
        "Only you can see the purchases saved to your Nobu account",
      );
      await expect(pageA.getByTestId("fixture-banner")).toHaveCount(0);
      await expect(pageA.getByTestId("purchases-table")).toBeVisible();
      await expect(pageA.getByTestId("purchase-row")).toHaveCount(1);
      await expect(pageA.locator(`a[href="/purchases/${purchaseId}"]`)).toBeVisible();

      // 2. User B list is empty / does not include A's purchase
      await pageB.goto("/dashboard");
      await expect(pageB.getByTestId("privacy-reassurance")).toBeVisible();
      await expect(pageB.getByTestId("fixture-banner")).toHaveCount(0);
      await expect(pageB.getByTestId("empty-dashboard")).toBeVisible();
      await expect(pageB.locator(`a[href="/purchases/${purchaseId}"]`)).toHaveCount(
        0,
      );

      // 3. User B opening A's URL gets generic not-found (same as missing)
      const res = await pageB.goto(`/purchases/${purchaseId}`);
      expect(res?.status()).toBe(404);
      const bodyB = (await pageB.locator("body").innerText()).toLowerCase();
      // Next default 404 body varies; never reveal the other user's product.
      expect(bodyB).not.toMatch(/privacy isolation widget/);
      expect(bodyB).not.toMatch(/example widget blue/);
      expect(pageB.url()).not.toMatch(/checked=1|MONITORING_ACTIVE/);

      // 4. User A still sees it
      await pageA.goto(`/purchases/${purchaseId}`);
      await expect(pageA.getByTestId("monitoring-proof")).toBeVisible({
        timeout: 15_000,
      });
      expect(pageA.url()).toContain(`/purchases/${purchaseId}`);
      await pageA.goto("/dashboard");
      await expect(pageA.getByTestId("purchase-row")).toHaveCount(1);

      // 5 + 6 already asserted: privacy reassurance present; Demo data absent on dashboard
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
