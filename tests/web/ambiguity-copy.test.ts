import { describe, expect, it } from "vitest";
import { enrollmentAmbiguityCopy } from "../../src/web/ambiguity-copy.js";

describe("enrollmentAmbiguityCopy", () => {
  it("does not ask for TCIN when TCIN is already stored", () => {
    const c = enrollmentAmbiguityCopy({
      reasons: ["no_strong_match"],
      has_tcin: true,
      has_model: true,
      has_upc: true,
      has_target_url: true,
      candidate_count: 0,
    });
    expect(c.body).not.toMatch(/Add a.*TCIN/i);
    expect(c.body).toMatch(/several different Target products/i);
  });

  it("asks only for missing identifiers when none supplied", () => {
    const c = enrollmentAmbiguityCopy({
      reasons: ["no_strong_match"],
      has_tcin: false,
      has_model: false,
      has_upc: false,
      has_target_url: false,
    });
    expect(c.body).toMatch(/Add a model, TCIN or UPC to narrow the match/i);
  });

  it("uses multi-product copy for genuine ambiguity reason", () => {
    const c = enrollmentAmbiguityCopy({
      reasons: ["ambiguous_multiple_strong_target_candidates"],
      has_tcin: true,
      candidate_count: 3,
    });
    expect(c.body).toBe(
      "Nobu found several different Target products and could not safely choose one.",
    );
  });
});
