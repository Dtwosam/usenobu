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
  "recover your money",
  "make money with nobu",
  "guaranteed savings",
  "claim secured",
];

const FORBIDDEN_PUBLIC = [
  "hackathon",
  "judge",
  "competition",
  "submission",
];

describe("Lane 8R.1 public interface positioning", () => {
  const publicFiles = [
    "app/page.tsx",
    "app/notices/page.tsx",
    "app/okx/page.tsx",
    "app/purchases/new/page.tsx",
    "app/purchases/new/PurchaseIntake.tsx",
    "src/ui/Header.tsx",
    "src/ui/Footer.tsx",
    "src/web/okx-marketplace.ts",
  ];

  it("homepage has five main sections and required copy", () => {
    const home = readFileSync(resolve("app/page.tsx"), "utf8");
    expect(home).toContain("Now live on OKX.AI · Agent 5541");
    expect(home).toContain("Catch price drops after you buy.");
    expect(home).toContain("Monitor on the website");
    expect(home).toContain("OkxMarketplaceLink");
    expect(home).toContain("How it works");
    expect(home).toContain("What Nobu is watching for");
    expect(home).toContain("Use Nobu your way");
    expect(home).toContain("Availability and trust");
    expect(home).toContain("Target is the only retailer currently supported");
    expect(home).toContain("More retailers are planned for the future");
    expect(home).toContain("Possible price difference");
    expect(home).toContain("$20.00");
    // Retailer sentence appears once on the homepage
    expect(
      home.split("Target is the only retailer currently supported").length - 1,
    ).toBe(1);
    expect(home).toContain("Add or describe a purchase");
    expect(home).toContain("Confirm the exact product");
    expect(home).toContain("Nobu monitors for a safely matched lower price");
    expect(home).toContain("Receive an alert in time to request the difference");
    expect(home).toContain("Nobu is listed on OKX.AI as Agent 5541");
    expect(home).toContain("Monitoring Pass — $0.99");
    expect(home).toContain("Purchase Setup — Free");
    expect(home).toContain("See Nobu in action");
    expect(home).toContain(
      "Buying the pass does not activate monitoring by itself",
    );
    // Demo block has no clickable control when no verified asset exists
    expect(home).not.toMatch(/okx-demo-(video|link|play)/);
    const sectionMatches = home.match(/className="n-home-section"/g) ?? [];
    // 4 n-home-section + hero = 5 main sections
    expect(sectionMatches.length).toBe(4);
    expect(home).toContain("n-hero");
  });

  it("homepage and public UI avoid guarantee and recovery language", () => {
    for (const file of publicFiles) {
      // Strip block comments so implementation notes are not scanned as copy
      const raw = readFileSync(resolve(file), "utf8");
      const text = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .toLowerCase();
      for (const phrase of FORBIDDEN_MONEY) {
        expect(text, `${file} must not say "${phrase}"`).not.toContain(phrase);
      }
      for (const phrase of FORBIDDEN_PUBLIC) {
        expect(text, `${file} must not say "${phrase}"`).not.toContain(phrase);
      }
    }
  });

  it("does not claim other retailers are live", () => {
    for (const file of publicFiles) {
      const text = readFileSync(resolve(file), "utf8").toLowerCase();
      for (const phrase of MISLEADING) {
        expect(text, `${file} must not claim "${phrase}"`).not.toContain(
          phrase,
        );
      }
    }
  });

  it("add-purchase intro and help panel explain exact product", () => {
    const form = readFileSync(
      resolve("app/purchases/new/PurchaseIntake.tsx"),
      "utf8",
    );
    expect(form).toContain("Tell Nobu what you bought");
    expect(form).toContain("Why the exact product matters");
    expect(form).toContain("fails closed");
    expect(form).toContain("Target — currently supported");
    expect(form).toContain("Find my product");
  });

  it("OKX guide is customer-facing and truthful about payment", () => {
    const okx = readFileSync(resolve("app/okx/page.tsx"), "utf8");
    expect(okx).toContain("Use Nobu with OKX.AI");
    expect(okx).toContain("One Monitoring Pass — $0.99");
    expect(okx).toContain("does not activate monitoring by itself");
    expect(okx).toContain("does not guarantee");
    expect(okx).toContain("Purchase Setup remains free");
    expect(okx).toContain("Open Nobu, Agent 5541, on OKX.AI.");
    expect(okx).toContain("Redeem the pass and activate monitoring");
    expect(okx).toContain("Does Nobu contact Target for me?");
    expect(okx).toContain("Does Nobu need my Target password?");
    expect(okx).toContain(
      "Does buying the Monitoring Pass start monitoring?",
    );
    expect(okx.toLowerCase()).not.toContain("coming soon");
    expect(okx.toLowerCase()).not.toContain("pending approval");
    // Old free-prep-before-payment sequence must not reappear as primary story
    expect(okx).not.toContain("Complete free purchase preparation");
    expect(okx).not.toContain(
      "When you are ready, activate monitoring for one confirmed and eligible purchase. Activation uses a one-time $0.99 payment.",
    );
  });

  it("marketplace CTA uses one configuration source", () => {
    const mod = readFileSync(resolve("src/web/okx-marketplace.ts"), "utf8");
    expect(mod).toContain("NEXT_PUBLIC_OKX_MARKETPLACE_URL");
    expect(mod).toContain("getOkxMarketplaceHref");
    expect(mod).toContain('"/okx"');
    const link = readFileSync(resolve("src/ui/OkxMarketplaceLink.tsx"), "utf8");
    expect(link).toContain("getOkxMarketplaceCta");
    // Components must not hardcode marketplace listing domains
    expect(link).not.toMatch(/https:\/\/web3\.okx\.com/);
  });

  it("notices include OKX payment and retailer decision truth", () => {
    const notices = readFileSync(resolve("app/notices/page.tsx"), "utf8");
    expect(notices).toContain(
      "The $0.99 OKX payment issues one Monitoring Pass for one eligible",
    );
    expect(notices).toContain(
      "Buying the pass does not activate monitoring by itself",
    );
    expect(notices).toContain("does not guarantee a price drop");
    expect(notices).toContain("does not contact Target");
    expect(notices).toContain("Price source");
    expect(notices).toContain("Stopping monitoring");
  });
});
