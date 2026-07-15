import { describe, expect, it } from "vitest";
import {
  hasAnyDemoDefault,
  isUnusableAfterDemoScrub,
  migrateSnapshotPurchases,
  scrubDemoDefaults,
  SESSION_SNAPSHOT_VERSION,
} from "../../src/web/demo-defaults.js";

describe("demo defaults scrub + session migration", () => {
  it("detects known Example Widget placeholders", () => {
    expect(
      hasAnyDemoDefault({
        target_product_url:
          "https://www.target.com/p/example-widget/-/A-87654321",
        target_item_id: "87654321",
        model_number: "WDG-100",
        product_title: "Example Widget Blue",
      }),
    ).toBe(true);
  });

  it("scrubs demo fields without touching fresh AirTag identity", () => {
    const scrubbed = scrubDemoDefaults({
      target_product_url:
        "https://www.target.com/p/apple-airtag/-/A-54191097",
      target_item_id: "54191097",
      model_number: "AirTag",
      product_title: "Apple AirTag",
    });
    expect(scrubbed.target_item_id).toBe("54191097");
    expect(scrubbed.target_product_url).toContain("54191097");
    expect(isUnusableAfterDemoScrub(scrubbed)).toBe(false);
  });

  it("prefers scrubbing demo TCIN/URL so stale defaults cannot contaminate", () => {
    const scrubbed = scrubDemoDefaults({
      target_product_url:
        "https://www.target.com/p/example-widget/-/A-87654321",
      target_item_id: "87654321",
      model_number: "WDG-100",
      product_title: "Example Widget Blue",
    });
    expect(scrubbed.target_product_url).toBe("");
    expect(scrubbed.target_item_id).toBeUndefined();
    expect(scrubbed.model_number).toBeUndefined();
    expect(scrubbed.product_title).toBeUndefined();
    expect(isUnusableAfterDemoScrub(scrubbed)).toBe(true);
  });

  it("drops unconfirmed demo drafts from pre-repair snapshots", () => {
    const { snapshot, dropped_demo_drafts } = migrateSnapshotPurchases({
      snapshot_version: 1,
      purchases: [
        {
          id: "pur_demo",
          target_product_url:
            "https://www.target.com/p/example-widget/-/A-87654321",
          target_item_id: "87654321",
          model_number: "WDG-100",
          product_title: "Example Widget Blue",
          fingerprint_id: null,
        },
        {
          id: "pur_real",
          target_product_url:
            "https://www.target.com/p/apple-airtag/-/A-54191097",
          target_item_id: "54191097",
          model_number: "AirTag",
          product_title: "Apple AirTag",
          fingerprint_id: null,
        },
        {
          id: "pur_confirmed_demo_shape",
          target_product_url:
            "https://www.target.com/p/example-widget/-/A-87654321",
          target_item_id: "87654321",
          fingerprint_id: "fp_keep_me",
        },
      ],
      enrollment_discovery: [
        { purchase_id: "pur_demo", evaluation_json: "{}" },
        { purchase_id: "pur_real", evaluation_json: "{}" },
      ],
    });

    expect(dropped_demo_drafts).toBe(1);
    expect(snapshot.purchases?.map((p) => p.id)).toEqual([
      "pur_real",
      "pur_confirmed_demo_shape",
    ]);
    expect(snapshot.enrollment_discovery?.map((d) => d.purchase_id)).toEqual([
      "pur_real",
    ]);
    expect(snapshot.snapshot_version).toBe(SESSION_SNAPSHOT_VERSION);
  });
});
