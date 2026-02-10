import { describe, expect, it } from "vitest";
import { createContractDetailsTracker } from "./contractDetailsTracker.js";

describe("createContractDetailsTracker", () => {
  it("requests contract details once per conId", () => {
    const tracker = createContractDetailsTracker(90_000);
    const first = tracker.nextRequest({
      conId: 265598,
      symbol: "AAPL",
      currency: "USD",
      exchange: "SMART",
      secType: "STK",
    });
    const second = tracker.nextRequest({
      conId: 265598,
      symbol: "AAPL",
      currency: "USD",
      exchange: "SMART",
      secType: "STK",
    });

    expect(first?.reqId).toBe(90_000);
    expect(second).toBeNull();
  });

  it("exposes cached market hours after contract details arrive", () => {
    const tracker = createContractDetailsTracker(90_000);
    const req = tracker.nextRequest({
      conId: 265598,
      symbol: "AAPL",
      currency: "USD",
      exchange: "SMART",
      secType: "STK",
    });

    expect(tracker.getCachedMarketHours(265598)).toBeUndefined();

    expect(req).toBeDefined();
    if (!req) throw new Error("expected request");
    tracker.onContractDetails(req.reqId, {
      contract: { conId: 265598 },
      timeZoneId: "America/New_York",
      liquidHours: "20260210:0930-1600",
      tradingHours: "20260210:0400-2000",
    });
    tracker.onContractDetailsEnd(req.reqId);

    const cached = tracker.getCachedMarketHours(265598);
    expect(cached).toEqual({
      timeZoneId: "America/New_York",
      liquidHours: "20260210:0930-1600",
      tradingHours: "20260210:0400-2000",
    });
  });
});
