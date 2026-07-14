/**
 * FIXTURE — gate: production never silently uses fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  isFixtureCheckAllowed,
  resolveManualCheckDataSource,
  shouldShowFixtureUiLabel,
  FIXTURE_UI_LABEL,
} from "../../src/web/manual-check-mode.js";

describe("manual check mode boundary (fixture)", () => {
  it("allows fixtures in test env", () => {
    expect(
      isFixtureCheckAllowed({ NODE_ENV: "test", VITEST: "true" }),
    ).toBe(true);
    expect(
      resolveManualCheckDataSource({
        prefer_fixture: true,
        env: { NODE_ENV: "test" },
      }),
    ).toBe("FIXTURE");
  });

  it("allows fixtures only with explicit NOBU_FIXTURE_MODE", () => {
    expect(
      isFixtureCheckAllowed({
        NODE_ENV: "production",
        NOBU_FIXTURE_MODE: "1",
      }),
    ).toBe(true);
    expect(
      isFixtureCheckAllowed({ NODE_ENV: "production" }),
    ).toBe(false);
  });

  it("production without gate resolves LIVE even if prefer_fixture", () => {
    expect(
      resolveManualCheckDataSource({
        prefer_fixture: true,
        env: { NODE_ENV: "production", VERCEL: "1" },
      }),
    ).toBe("LIVE");
  });

  it("default production path is LIVE", () => {
    expect(
      resolveManualCheckDataSource({
        env: { NODE_ENV: "production" },
      }),
    ).toBe("LIVE");
  });

  it("NOBU_FORCE_LIVE_CHECKS disables fixtures", () => {
    expect(
      isFixtureCheckAllowed({
        NODE_ENV: "test",
        NOBU_FORCE_LIVE_CHECKS: "1",
      }),
    ).toBe(false);
  });

  it("fixture UI label is short and exact", () => {
    expect(FIXTURE_UI_LABEL).toBe(
      "Test data — not a live current retailer price.",
    );
    expect(shouldShowFixtureUiLabel({ NODE_ENV: "production" })).toBe(false);
    expect(shouldShowFixtureUiLabel({ NOBU_FIXTURE_MODE: "1" })).toBe(true);
  });
});
