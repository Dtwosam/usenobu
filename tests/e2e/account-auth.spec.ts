/**
 * Lane 7.3A.2A.1 — passwordless account + guest claim Playwright proof.
 */
import { test, expect, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

const PROOF = path.join("docs", "proof", "lane-7-3a-2a-1-auth", "screens");

async function fillSignInEmail(page: import("@playwright/test").Page, email: string) {
  await expect(page.getByTestId("sign-in-form")).toBeVisible();
  const input = page.getByTestId("sign-in-email");
  await input.waitFor({ state: "visible" });
  // Wait for client hydration so controlled input onChange is attached.
  await page.waitForLoadState("networkidle").catch(() => {});
  await input.click();
  await input.fill("");
  await page.keyboard.type(email, { delay: 25 });
  await expect(input).toHaveValue(email);
  await expect(page.getByTestId("sign-in-submit")).toBeEnabled({
    timeout: 15_000,
  });
}

test.describe("passwordless account auth", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  test("guest purchase → sign-in → claim → logout → re-login isolation", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(180_000);
    const contextA = await browser.newContext();
    const page = await contextA.newPage();

    // 1. Guest purchase
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await setFixtureScenario(page, "exact_match");
    await fillFixtureExactIdentity(page, { title: "Auth Guest Widget" });
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);

    await page.goto("/dashboard");
    await expect(page.getByTestId("guest-notice")).toBeVisible();
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);

    // Desktop guest notice screenshot
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: path.join(PROOF, "desktop-guest-notice.png"),
      fullPage: true,
    });

    // 2–4. Sign-in form + email sent
    await page.goto("/sign-in");
    await expect(page.getByTestId("sign-in-form")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "desktop-sign-in-form.png"),
      fullPage: true,
    });

    await fillSignInEmail(page, "auth-proof@example.com");
    await page.getByTestId("sign-in-submit").click();
    await expect(page.getByTestId("sign-in-sent")).toBeVisible();
    await expect(page.getByText("Check your email")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "desktop-check-email.png"),
      fullPage: true,
    });

    // 5. Deterministic test verification
    await page.getByTestId("sign-in-test-complete").click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // 6–7. Claim + account indicator
    await expect(page.getByTestId("claim-success")).toBeVisible();
    await expect(page.getByTestId("claim-count")).toContainText("purchase");
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();
    await expect(page.getByTestId("guest-notice")).toHaveCount(0);
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);
    await page.screenshot({
      path: path.join(PROOF, "desktop-claim-success.png"),
      fullPage: true,
    });

    await page.getByTestId("account-menu-trigger").click();
    await expect(page.getByTestId("account-menu-dropdown")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "desktop-account-menu.png"),
      fullPage: false,
    });

    // 8–9. Logout hides account purchase from guest
    await page.getByTestId("account-menu-sign-out").click();
    await page.waitForURL(/\//, { timeout: 15_000 });
    await expect(page.getByTestId("signed-out-toast")).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByTestId("guest-notice")).toBeVisible();
    await expect(page.getByTestId("empty-dashboard")).toBeVisible();
    await expect(page.getByTestId("purchase-row")).toHaveCount(0);

    // 10. Log back in — purchases return
    await page.goto("/sign-in");
    await fillSignInEmail(page, "auth-proof@example.com");
    await page.getByTestId("sign-in-submit").click();
    await expect(page.getByTestId("sign-in-sent")).toBeVisible();
    await page.getByTestId("sign-in-test-complete").click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByTestId("purchase-row")).toHaveCount(1);
    await expect(page.getByTestId("account-menu-trigger")).toBeVisible();

    const purchaseHref = await page
      .getByTestId("purchase-row")
      .first()
      .getAttribute("href");
    expect(purchaseHref).toBeTruthy();

    // 11. Separate guest cannot see it
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(pageB.getByTestId("purchase-row")).toHaveCount(0);
    if (purchaseHref) {
      const res = await pageB.goto(purchaseHref, {
        waitUntil: "domcontentloaded",
      });
      expect(res?.status()).toBe(404);
    }

    // 12. Account A cannot access account B
    await pageB.goto("/sign-in", { waitUntil: "networkidle" });
    await fillSignInEmail(pageB, "auth-other@example.com");
    await pageB.getByTestId("sign-in-submit").click();
    await expect(pageB.getByTestId("sign-in-sent")).toBeVisible({
      timeout: 15_000,
    });
    await pageB.getByTestId("sign-in-test-complete").click();
    await pageB.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await expect(pageB.getByTestId("purchase-row")).toHaveCount(0);
    if (purchaseHref) {
      const res = await pageB.goto(purchaseHref, {
        waitUntil: "domcontentloaded",
      });
      expect(res?.status()).toBe(404);
    }

    // 13. Mobile sign-in + guest notice
    await pageB.goto("/?signed_out=1"); // ensure guest after new context signed in - sign out first
    await pageB.getByTestId("account-menu-trigger").click().catch(() => {});
    // Use mobile nav sign out if needed
    await pageB.goto("/dashboard");
    // sign out via mobile if menu present
    if (await pageB.getByTestId("account-menu-trigger").count()) {
      await pageB.getByTestId("account-menu-trigger").click();
      await pageB.getByTestId("account-menu-sign-out").click();
    }

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const pageM = await mobile.newPage();
    await pageM.goto("/sign-in");
    await expect(pageM.getByTestId("sign-in-form")).toBeVisible();
    await pageM.screenshot({
      path: path.join(PROOF, "mobile-sign-in-form.png"),
      fullPage: true,
    });
    await fillSignInEmail(pageM, "mobile@example.com");
    await pageM.getByTestId("sign-in-submit").click();
    await expect(pageM.getByTestId("sign-in-sent")).toBeVisible();
    await pageM.screenshot({
      path: path.join(PROOF, "mobile-check-email.png"),
      fullPage: true,
    });

    // Mobile guest notice on dashboard (still guest until complete)
    await pageM.goto("/dashboard");
    await expect(pageM.getByTestId("guest-notice")).toBeVisible();
    await pageM.screenshot({
      path: path.join(PROOF, "mobile-guest-notice.png"),
      fullPage: true,
    });

    // Expired link state (desktop)
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/sign-in?error=expired");
    await expect(page.getByTestId("sign-in-invalid")).toBeVisible();
    await page.screenshot({
      path: path.join(PROOF, "desktop-expired-link.png"),
      fullPage: true,
    });

    // Mobile account nav after login
    await pageM.goto("/sign-in");
    await fillSignInEmail(pageM, "mobile@example.com");
    await pageM.getByTestId("sign-in-submit").click();
    await expect(pageM.getByTestId("sign-in-sent")).toBeVisible();
    await pageM.getByTestId("sign-in-test-complete").click();
    await pageM.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await pageM.getByTestId("nav-menu-toggle").click();
    await expect(pageM.getByTestId("nav-mobile-panel")).toHaveAttribute(
      "data-open",
      "true",
    );
    await expect(pageM.getByTestId("nav-mobile-account")).toBeVisible();
    await pageM.screenshot({
      path: path.join(PROOF, "mobile-account-nav.png"),
      fullPage: true,
    });

    await contextA.close();
    await contextB.close();
    await mobile.close();
  });
});
