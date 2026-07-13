import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDaysSincePurchase,
  hoursBetween,
} from "../../src/policy/index.js";

describe("policy calendar day math", () => {
  it("treats purchase day as day 0", () => {
    expect(calendarDaysSincePurchase("2026-07-01", "2026-07-01")).toBe(0);
    expect(
      calendarDaysSincePurchase("2026-07-01", "2026-07-01T23:59:59.000Z"),
    ).toBe(0);
  });

  it("includes day 14 in window boundary math", () => {
    expect(calendarDaysSincePurchase("2026-07-01", "2026-07-15")).toBe(14);
    expect(addCalendarDays("2026-07-01", 14)).toBe("2026-07-15");
  });

  it("marks day 15 as 15 calendar days after purchase", () => {
    expect(calendarDaysSincePurchase("2026-07-01", "2026-07-16")).toBe(15);
  });

  it("detects future purchase dates as negative offset", () => {
    expect(calendarDaysSincePurchase("2026-07-20", "2026-07-13")).toBe(-7);
  });

  it("computes hours between timestamps", () => {
    expect(
      hoursBetween("2026-07-13T00:00:00.000Z", "2026-07-14T00:00:00.000Z"),
    ).toBe(24);
  });
});
