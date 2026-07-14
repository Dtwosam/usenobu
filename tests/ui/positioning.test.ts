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
  "more retailers coming soon",
];

const FORBIDDEN_MONEY = [
  "guaranteed refund",
  "nobu gets your refund",
  "nobu recovers your money",
  "automatic refund",
  "refund confirmed",
  "target owes you",
  "you will get the difference back",
  "claim approved",
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

  it("homepage hero is retailer-neutral with money-back benefit", () => {
    const home = readFileSync(resolve("app/page.tsx"), "utf8");
    expect(home).toContain("Nobu watches prices after you buy.");
    expect(home).toContain("Add a purchase");
    expect(home).toContain("How it works");
    expect(home).toContain("request the difference back");
    expect(home).toContain("Currently supported");
    expect(home).toContain("Eligible Target.com purchases");
    expect(home).toContain("Nobu is starting with eligible Target.com purchases.");
    // Hero block must not hardcode Target in the lead (availability section may)
    const heroStart = home.indexOf("n-hero");
    const stepsStart = home.indexOf("how-it-works");
    const heroChunk = home.slice(heroStart, stepsStart);
    expect(heroChunk.toLowerCase()).not.toContain("target");
    expect(home).not.toContain("Track a Target purchase");
    expect(home).not.toContain("Ask Nobu to watch a purchase");
  });

  it("homepage three steps are retailer-neutral", () => {
    const home = readFileSync(resolve("app/page.tsx"), "utf8");
    expect(home).toContain("Add your purchase");
    expect(home).toContain("Nobu keeps watch");
    expect(home).toContain("Request the difference");
    const stepsStart = home.indexOf("home-steps");
    const availStart = home.indexOf("current-availability");
    const stepsChunk = home.slice(stepsStart, availStart).toLowerCase();
    expect(stepsChunk).not.toContain("target");
  });

  it("homepage money-back copy is qualified not guaranteed", () => {
    const home = readFileSync(resolve("app/page.tsx"), "utf8").toLowerCase();
    for (const phrase of FORBIDDEN_MONEY) {
      expect(home, `homepage must not say "${phrase}"`).not.toContain(phrase);
    }
    expect(home).toContain("may be able to get back");
    expect(home).toContain("request the difference back");
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
