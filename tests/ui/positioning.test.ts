import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MISLEADING = [
  "all major retailers",
  "any retailer",
  "every retailer",
  "walmart is live",
  "amazon is live",
  "best buy is live",
  "coming soon: walmart",
  "coming soon: amazon",
  "multi-retailer live",
];

describe("universal platform positioning copy", () => {
  const files = [
    "app/page.tsx",
    "app/notices/page.tsx",
    "app/purchases/new/page.tsx",
    "PROJECT_DESCRIPTION.md",
    "README.md",
    "docs/nobu-clean-master-spec.md",
    "docs/nobu-current-state.md",
  ];

  it("homepage uses agent CTA and Target availability label", () => {
    const home = readFileSync(resolve("app/page.tsx"), "utf8");
    expect(home).toContain("Ask Nobu to watch a purchase");
    expect(home).toContain("Currently supports eligible Target.com purchases");
    expect(home).toContain("Your AI agent after checkout");
    expect(home).toContain("Tell Nobu what you bought");
    expect(home).not.toContain("Track a Target purchase");
  });

  it("add-purchase labels Target as currently supported retailer", () => {
    const form = readFileSync(
      resolve("app/purchases/new/PurchaseIntake.tsx"),
      "utf8",
    );
    expect(form).toContain("Tell Nobu what you bought");
    expect(form).toContain("Target — currently supported");
    expect(form).toContain("This retailer isn’t supported yet");
    expect(form).toContain("Fill details with AI");
    expect(form).toContain("Find my product");
  });

  it("does not claim other retailers are live", () => {
    for (const file of files) {
      const text = readFileSync(resolve(file), "utf8").toLowerCase();
      for (const phrase of MISLEADING) {
        expect(text, `${file} must not claim "${phrase}"`).not.toContain(
          phrase,
        );
      }
    }
  });

  it("master definition states platform + Target-only live", () => {
    const spec = readFileSync(resolve("docs/nobu-clean-master-spec.md"), "utf8");
    expect(spec).toContain("retailer-specific connectors");
    expect(spec).toContain(
      "current live version supports eligible Target.com and Target app purchases only",
    );
    expect(spec).toContain(
      "Add a supported purchase once. Nobu watches the retailer price",
    );
  });
});
