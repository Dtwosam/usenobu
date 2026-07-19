import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const intake = readFileSync(
  resolve("app/purchases/new/PurchaseIntake.tsx"),
  "utf8",
);

describe("manual entry disclosure source contract", () => {
  it("starts with manual form collapsed (false) unless error return", () => {
    expect(intake).toMatch(/useState\(\s*\(\)\s*=>\s*Boolean\(serverError/);
    expect(intake).not.toMatch(/useState\(true\)/);
  });

  it("toggles showManual and labels Hide manual form", () => {
    expect(intake).toContain("toggleManual");
    expect(intake).toContain("Hide manual form");
    expect(intake).toContain("Enter details manually");
    expect(intake).toContain('aria-expanded={showManual}');
    expect(intake).toContain("aria-controls");
    expect(intake).toContain('type="button"');
  });

  it("opens manual form on AI success and failure", () => {
    expect(intake).toMatch(/setAiError\([\s\S]*openManual/);
    expect(intake).toMatch(/setReviewed\(true\);\s*openManual/);
  });

  it("keeps model and UPC as progressive fallback fields", () => {
    expect(intake).toContain("Optional unless Nobu asks for one after discovery.");
    expect(intake).toContain("identity-progressive-note");
    expect(intake).not.toMatch(/id="model_number"[\s\S]{0,220}required/);
    expect(intake).not.toMatch(/id="upc_or_gtin"[\s\S]{0,220}required/);
  });

  it("offers exact and find product-entry modes without Demo options", () => {
    expect(intake).toContain('data-testid="mode-exact"');
    expect(intake).toContain('data-testid="mode-find"');
    expect(intake).not.toMatch(/Demo options/i);
    expect(intake).not.toMatch(/input-scenario/);
  });
});
