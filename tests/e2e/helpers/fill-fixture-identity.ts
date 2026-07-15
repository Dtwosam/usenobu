import type { Page } from "@playwright/test";

/** Minimum exact identity for fixture Find my product (URL + TCIN + model). */
export async function fillFixtureExactIdentity(
  page: Page,
  opts?: {
    url?: string;
    tcin?: string;
    model?: string;
    upc?: string;
    price?: string;
    date?: string;
    region?: string;
    title?: string;
  },
) {
  const url =
    opts?.url ?? "https://www.target.com/p/example-widget/-/A-87654321";
  const tcin = opts?.tcin ?? "87654321";
  const model = opts?.model ?? "WDG-100";
  const price = opts?.price ?? "24.99";
  const date = opts?.date ?? new Date().toISOString().slice(0, 10);
  const region = opts?.region ?? "TX";
  const title = opts?.title ?? "Example Widget Blue";

  await page.getByTestId("input-url").fill(url);
  await page.getByTestId("input-tcin").fill(tcin);
  if (opts?.upc) {
    await page.getByTestId("input-upc").fill(opts.upc);
    await page.getByTestId("input-model").fill("");
  } else {
    await page.getByTestId("input-model").fill(model);
  }
  await page.getByTestId("input-price").fill(price);
  await page.getByTestId("input-date").fill(date);
  await page.getByTestId("input-region").fill(region);
  await page.getByTestId("input-title").fill(title);
}
