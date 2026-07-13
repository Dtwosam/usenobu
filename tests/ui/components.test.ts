import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as ui from "../../src/ui/index.js";

const REQUIRED_EXPORTS = [
  "Header",
  "Footer",
  "Button",
  "ButtonLink",
  "IconButton",
  "Card",
  "Input",
  "Select",
  "DateInput",
  "CurrencyInput",
  "Field",
  "FormError",
  "Badge",
  "StatusBadge",
  "DemoDataBanner",
  "InlineNotice",
  "PageHeader",
  "SectionHeader",
  "Stepper",
  "ProductCard",
  "PriceSummary",
  "EmptyState",
  "LoadingSkeleton",
  "Disclosure",
] as const;

const REQUIRED_TOKENS = [
  "--canvas",
  "--surface",
  "--ink",
  "--brand",
  "--brand-hover",
  "--brand-active",
  "--brand-soft",
  "--accent",
  "--success",
  "--warning",
  "--danger",
  "--radius-card",
  "--control-min-height",
  "--container-main",
  "--font-sans",
] as const;

const FORBIDDEN_PHRASES = [
  "guaranteed refund",
  "we will refund",
  "instant refund",
  "100% refund",
] as const;

describe("Nobu UI foundation exports", () => {
  it("exports every required foundation component", () => {
    for (const name of REQUIRED_EXPORTS) {
      expect(ui, name).toHaveProperty(name);
      expect(typeof (ui as Record<string, unknown>)[name]).toBe("function");
    }
  });
});

describe("Nobu design tokens", () => {
  const css = readFileSync(resolve("app/globals.css"), "utf8");

  it("defines the locked color and layout tokens", () => {
    for (const token of REQUIRED_TOKENS) {
      expect(css).toContain(token);
    }
    expect(css).toContain("#1f5a4a");
    expect(css).toContain("#f6f5f0");
    expect(css).toContain("48px");
    expect(css).toContain("44px");
  });

  it("supports reduced motion", () => {
    expect(css).toContain("prefers-reduced-motion");
  });

  it("does not introduce a second styling system beyond n- and legacy bridge", () => {
    expect(css).toContain(".n-btn");
    expect(css).toContain(".n-card");
    expect(css).toContain("Legacy bridge");
  });
});

describe("Foundation UX copy guardrails", () => {
  it("design spec and foundation page avoid guaranteed-refund language", () => {
    const files = [
      "docs/nobu-ui-design-spec.md",
      "app/design/foundation/page.tsx",
      "src/ui/Footer.tsx",
      "app/page.tsx",
    ];
    for (const file of files) {
      const text = readFileSync(resolve(file), "utf8").toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(text, `${file} must not contain "${phrase}"`).not.toContain(
          phrase,
        );
      }
    }
  });

  it("design spec locks first-time UX rules", () => {
    const spec = readFileSync(resolve("docs/nobu-ui-design-spec.md"), "utf8");
    expect(spec).toContain("One primary action");
    expect(spec).toContain("Plain English");
    expect(spec).toContain("progressive disclosure");
    expect(spec.toLowerCase()).toContain("no guaranteed-refund");
    expect(spec).toContain("Target decides");
  });
});
