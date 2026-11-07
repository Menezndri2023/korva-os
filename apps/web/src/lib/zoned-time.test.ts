import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "./zoned-time";

describe("zonedTimeToUtc", () => {
  it("reads the time in the business's timezone, whatever the browser's", () => {
    expect(zonedTimeToUtc("2026-07-06", "14:00", "Europe/Paris").toISOString()).toBe("2026-07-06T12:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-07", "14:00", "Europe/Paris").toISOString()).toBe("2026-12-07T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-07-06", "14:00", "Africa/Abidjan").toISOString()).toBe("2026-07-06T14:00:00.000Z");
  });
});
