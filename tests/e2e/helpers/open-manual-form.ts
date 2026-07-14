import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Wait until the client component has hydrated event handlers. */
async function waitForClientHandlers(page: Page, testId: string) {
  await page.waitForFunction(
    (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return false;
      return Object.keys(el).some(
        (k) =>
          k.startsWith("__reactFiber") ||
          k.startsWith("__reactProps") ||
          k.startsWith("__reactContainer"),
      );
    },
    testId,
    { timeout: 20_000 },
  );
}

/** Expand structured purchase form when collapsed on /purchases/new. */
export async function openManualPurchaseForm(page: Page) {
  const form = page.getByTestId("purchase-form");
  if ((await form.count()) > 0 && (await form.isVisible())) {
    return;
  }

  const btn = page.getByTestId("btn-manual-entry");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveAttribute("type", "button");
  await waitForClientHandlers(page, "btn-manual-entry");

  // Retry clicks for soft-nav races after Link navigation
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await form.count()) > 0 && (await form.isVisible())) {
      return;
    }
    await btn.click({ force: attempt > 0 });
    try {
      await expect(page.getByTestId("purchase-form")).toBeVisible({
        timeout: 4_000,
      });
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      return;
    } catch {
      // retry
    }
  }

  await expect(page.getByTestId("purchase-form")).toBeVisible({
    timeout: 5_000,
  });
}
