import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const PROOF = path.join("docs", "proof", "ui", "screens");

test.describe("Consumer screens a11y + overflow", () => {
  test.beforeAll(() => {
    fs.mkdirSync(PROOF, { recursive: true });
  });

  for (const route of ["/", "/purchases/new", "/notices", "/dashboard"] as const) {
    test(`axe + overflow: ${route}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route);
      const overflow = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      expect(overflow.sw, `overflow on ${route}`).toBeLessThanOrEqual(
        overflow.cw + 1,
      );

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );
      fs.writeFileSync(
        path.join(
          PROOF,
          `axe${route === "/" ? "-home" : route.replace(/\//g, "-")}.json`,
        ),
        JSON.stringify(
          {
            route,
            violations: results.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.length,
            })),
            passes: results.passes.length,
          },
          null,
          2,
        ),
        "utf8",
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    });
  }
});
