/**
 * Lane 7.3B — signed-in alert preference, guest sign-in CTA,
 * enable/disable, refresh persistence, 390px layout.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

const PROOF = path.join("docs", "proof", "lane-7-3b-email-alerts", "screens");

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

async function createConfirmedPurchase(page: Page, title: string) {
  await page.goto("/purchases/new");
  await openManualPurchaseForm(page);
  await setFixtureScenario(page, "exact_match");
  await fillFixtureExactIdentity(page, { title });
  await Promise.all([
    page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
    page.getByTestId("submit-purchase").click(),
  ]);
  // Confirm if button present
  const confirm = page.getByTestId("confirm-candidate");
  if (await confirm.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForURL(/\/purchases\/(?!.*review)/, { timeout: 45_000 }),
      confirm.click(),
    ]);
  } else {
    // Navigate to purchase from review page if already locked
    const url = page.url();
    const m = /\/purchases\/([^/]+)/.exec(url);
    if (m) await page.goto(`/purchases/${m[1]}`);
  }
  await expect(page.getByTestId("monitoring-proof")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("email alert preference UI", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  test("guest shows sign-in CTA; signed-in enable/disable persists; 390px", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // Guest path: create purchase without account
    await page.goto("/purchases/new");
    await openManualPurchaseForm(page);
    await setFixtureScenario(page, "exact_match");
    await fillFixtureExactIdentity(page, { title: "Guest Alert Widget" });
    await Promise.all([
      page.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      page.getByTestId("submit-purchase").click(),
    ]);
    const confirmGuest = page.getByTestId("confirm-candidate");
    if (await confirmGuest.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/purchases\/(?!.*review)/, { timeout: 45_000 }),
        confirmGuest.click(),
      ]);
    }
    await expect(page.getByTestId("monitoring-proof")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("email-alert-pref")).toBeVisible();
    await expect(page.getByTestId("alert-pref-guest")).toContainText(
      "Sign in to receive automatic email alerts",
    );
    await expect(page.getByTestId("alert-pref-sign-in")).toBeVisible();
    // No email input for guest
    await expect(page.locator('input[type="email"]')).toHaveCount(0);
    await page.screenshot({
      path: path.join(PROOF, "desktop-guest-alert-pref.png"),
      fullPage: true,
    });

    // Signed-in path
    await signInTest(page, "email-alerts-e2e@example.com");
    await createConfirmedPurchase(page, "Account Alert Widget");

    await expect(page.getByTestId("email-alert-pref")).toBeVisible();
    await expect(page.getByTestId("email-alert-switch")).toBeVisible();
    await expect(page.getByTestId("alert-pref-support")).toContainText(
      "Alerts will be sent",
    );

    // Enable
    await page.getByTestId("email-alert-switch").check();
    await expect(page.getByTestId("email-alert-switch")).toBeChecked();
    await expect(page.getByTestId("nobu-watching")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("nobu-watching")).toContainText(
      "Monitoring active",
    );
    await page.screenshot({
      path: path.join(PROOF, "desktop-alerts-enabled.png"),
      fullPage: true,
    });

    // Refresh persistence
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("email-alert-switch")).toBeChecked();
    await expect(page.getByTestId("nobu-watching")).toBeVisible();

    // Disable
    await page.getByTestId("email-alert-switch").uncheck();
    await expect(page.getByTestId("email-alert-switch")).not.toBeChecked();
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("email-alert-switch")).not.toBeChecked();

    // 390px layout
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("email-alert-switch").check();
    await expect(page.getByTestId("email-alert-pref")).toBeVisible();
    const box = await page.getByTestId("email-alert-pref").boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeLessThanOrEqual(390);
    }
    // No horizontal overflow of main screen
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    });
    expect(overflow).toBe(false);
    await page.screenshot({
      path: path.join(PROOF, "mobile-390-alert-pref.png"),
      fullPage: true,
    });
  });
});
