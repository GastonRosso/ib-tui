import { describe, expect, it } from "vitest";
import { resolveMarketHours, formatMarketHoursCountdown } from "./marketHours.js";

describe("resolveMarketHours", () => {
  it("returns OPEN and time-to-close for US equity hours", () => {
    const now = Date.parse("2026-02-10T15:00:00.000Z"); // 10:00 New York
    const session = resolveMarketHours(
      {
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: "20260210:0400-2000;20260211:0400-2000",
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatMarketHoursCountdown(session)).toBe("6h 0m to close");
  });

  it("returns CLOSED and time-to-open after close", () => {
    const now = Date.parse("2026-02-10T22:00:00.000Z"); // 17:00 New York
    const session = resolveMarketHours(
      {
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("closed");
    expect(formatMarketHoursCountdown(session)).toBe("16h 30m to open");
  });

  it("handles a different market timezone for another asset", () => {
    const now = Date.parse("2026-02-10T01:00:00.000Z"); // 10:00 Tokyo
    const session = resolveMarketHours(
      {
        timeZoneId: "Asia/Tokyo",
        liquidHours: "20260210:0900-1500;20260211:0900-1500",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatMarketHoursCountdown(session)).toBe("5h 0m to close");
  });

  it("maps IB EST timezone to America/New_York (DST-aware)", () => {
    const now = Date.parse("2026-07-10T15:00:00.000Z"); // 11:00 EDT, not 10:00
    const session = resolveMarketHours(
      {
        timeZoneId: "EST",
        liquidHours: "20260710:0930-1600;20260713:0930-1600",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatMarketHoursCountdown(session)).toBe("5h 0m to close");
  });

  it("handles v970+ format with date on both sides of dash", () => {
    const now = Date.parse("2026-02-10T15:00:00.000Z"); // 10:00 New York
    const session = resolveMarketHours(
      {
        timeZoneId: "US/Eastern",
        liquidHours: "20260210:0930-20260210:1600;20260211:0930-20260211:1600",
        tradingHours: "20260210:0400-20260210:2000;20260211:0400-20260211:2000",
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatMarketHoursCountdown(session)).toBe("6h 0m to close");
  });

  it("returns unknown for null marketHours", () => {
    const session = resolveMarketHours(null);
    expect(session.status).toBe("unknown");
    expect(formatMarketHoursCountdown(session)).toBe("n/a");
  });

  it("returns unknown for missing timeZoneId", () => {
    const session = resolveMarketHours({
      timeZoneId: null,
      liquidHours: "20260210:0930-1600",
      tradingHours: null,
    });
    expect(session.status).toBe("unknown");
  });
});
