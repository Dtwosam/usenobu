/**
 * Lane 7.3A.2A.1R — GET peek + POST confirm, cross-browser session, replay.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openManualPurchaseForm } from "./helpers/open-manual-form";
import { fillFixtureExactIdentity } from "./helpers/fill-fixture-identity";
import { setFixtureScenario } from "./helpers/set-fixture-scenario";

const PROOF = path.join("docs", "proof", "lane-7-3a-2a-1r-auth", "screens");

async function fillSignInEmail(page: Page, email: string) {
  await expect(page.getByTestId("sign-in-form")).toBeVisible();
  const input = page.getByTestId("sign-in-email");
  await page.waitForLoadState("networkidle").catch(() => {});
  await input.click();
  await input.fill("");
  await page.keyboard.type(email, { delay: 20 });
  await expect(page.getByTestId("sign-in-submit")).toBeEnabled({
    timeout: 15_000,
  });
}

async function requestLinkAndGetToken(page: Page, email: string): Promise<string> {
  await page.goto("/sign-in", { waitUntil: "networkidle" });
  await fillSignInEmail(page, email);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in-sent")).toBeVisible({ timeout: 15_000 });
  const tokenRes = await page.request.post("/api/test/last-auth-token", {
    data: { email },
  });
  expect(tokenRes.ok()).toBeTruthy();
  const body = (await tokenRes.json()) as { token?: string };
  expect(body.token).toBeTruthy();
  return body.token!;
}

test.describe("auth 1R durable verify", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  test("GET peek, POST confirm, cross-context session, replay", async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    test.setTimeout(180_000);
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Guest purchase in A
    await pageA.goto("/purchases/new");
    await openManualPurchaseForm(pageA);
    await setFixtureScenario(pageA, "exact_match");
    await fillFixtureExactIdentity(pageA, { title: "1R Guest Widget" });
    await Promise.all([
      pageA.waitForURL(/\/purchases\/.+\/review/, { timeout: 45_000 }),
      pageA.getByTestId("submit-purchase").click(),
    ]);

    // 1. Request link in browser A
    const token = await requestLinkAndGetToken(pageA, "repair-auth@example.com");

    // 2. Open in second context (phone) — GET does not consume
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto(`/auth/verify?token=${encodeURIComponent(token)}`, {
      waitUntil: "networkidle",
    });
    await expect(pageB.getByTestId("verify-confirm-card")).toBeVisible();
    await pageB.setViewportSize({ width: 1440, height: 1000 });
    await pageB.screenshot({
      path: path.join(PROOF, "desktop-verify-confirm.png"),
      fullPage: true,
    });

    // Preview GET again still valid
    await pageB.goto(`/auth/verify?token=${encodeURIComponent(token)}`, {
      waitUntil: "networkidle",
    });
    await expect(pageB.getByTestId("verify-confirm-card")).toBeVisible();

    // 3. Explicit POST confirm
    await pageB.getByTestId("verify-continue").click();
    await pageB.waitForURL(/\/dashboard/, { timeout: 30_000 });

    // 4. Signed-in navigation
    await expect(pageB.getByTestId("account-menu-trigger")).toBeVisible();
    await expect(pageB.getByTestId("claim-success")).toBeVisible();
    await expect(pageB.getByTestId("purchase-row")).toHaveCount(1);

    // 5. Refresh remains signed in
    await pageB.reload({ waitUntil: "networkidle" });
    await expect(pageB.getByTestId("account-menu-trigger")).toBeVisible();
    await expect(pageB.getByTestId("purchase-row")).toHaveCount(1);

    // 6. Replay rejected
    await pageB.goto(`/auth/verify?token=${encodeURIComponent(token)}`, {
      waitUntil: "networkidle",
    });
    await expect(pageB.getByTestId("sign-in-invalid")).toBeVisible();
    await pageB.screenshot({
      path: path.join(PROOF, "desktop-replay-invalid.png"),
      fullPage: true,
    });

    // 7. Mobile 390px confirm page
    const contextC = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const pageC = await contextC.newPage();
    const tokenM = await requestLinkAndGetToken(
      pageC,
      "repair-mobile@example.com",
    );
    await pageC.goto(`/auth/verify?token=${encodeURIComponent(tokenM)}`, {
      waitUntil: "networkidle",
    });
    await expect(pageC.getByTestId("verify-confirm-card")).toBeVisible();
    await pageC.screenshot({
      path: path.join(PROOF, "mobile-verify-confirm.png"),
      fullPage: true,
    });
    await pageC.getByTestId("verify-continue").click();
    await pageC.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await pageC.getByTestId("nav-menu-toggle").click();
    await expect(pageC.getByTestId("nav-mobile-account")).toBeVisible();
    await pageC.screenshot({
      path: path.join(PROOF, "mobile-account-nav.png"),
      fullPage: true,
    });

    await contextA.close();
    await contextB.close();
    await contextC.close();
  });
});
