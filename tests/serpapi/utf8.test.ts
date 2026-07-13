import { describe, expect, it } from "vitest";
import {
  decodeShoppingTitle,
  titleLooksWellFormedUtf8,
} from "../../src/serpapi/index.js";

describe("UTF-8 shopping title decoding", () => {
  it("preserves clean titles", () => {
    const t = "Apple AirPods Pro (2nd Generation) USB-C";
    expect(decodeShoppingTitle(t)).toBe(t);
    expect(titleLooksWellFormedUtf8(t)).toBe(true);
  });

  it("repairs classic UTF-8-as-Latin1 mojibake when detectable", () => {
    // "Café" encoded as UTF-8 then misread as Latin-1 → "CafÃ©"
    const mojibake = "CafÃ© Headphones";
    const fixed = decodeShoppingTitle(mojibake);
    expect(fixed.includes("Café") || fixed.includes("Cafe")).toBe(true);
  });

  it("flags replacement characters as not well-formed", () => {
    expect(titleLooksWellFormedUtf8("AirPods Pro Usb\uFFFD c")).toBe(false);
  });
});
