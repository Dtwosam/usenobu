import type { Page } from "@playwright/test";

/**
 * Inject a hidden fixture_scenario field for e2e only.
 * Production UI never shows Demo options; the server only honors this value
 * when the fixture discovery gate is open (NOBU_FIXTURE_MODE=1).
 */
export async function setFixtureScenario(
  page: Page,
  scenario: "exact_match" | "ambiguous" | "no_price" | "unsupported" | "multi_candidate",
) {
  await page.evaluate((value) => {
    const form = document.querySelector(
      '[data-testid="purchase-form"]',
    ) as HTMLFormElement | null;
    if (!form) return;
    let input = form.querySelector(
      'input[name="fixture_scenario"]',
    ) as HTMLInputElement | null;
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "fixture_scenario";
      input.setAttribute("data-testid", "input-scenario-hidden");
      form.appendChild(input);
    }
    input.value = value;
  }, scenario);
}
