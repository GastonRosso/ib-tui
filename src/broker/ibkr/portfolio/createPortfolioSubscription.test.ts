import { describe, expect, it, vi } from "vitest";
import EventEmitter from "events";
import { createPortfolioSubscription } from "./createPortfolioSubscription.js";

const createMockApi = () =>
  Object.assign(new EventEmitter(), {
    reqAccountUpdates: vi.fn(),
    reqContractDetails: vi.fn(),
    removeListener: EventEmitter.prototype.removeListener,
  });

describe("createPortfolioSubscription", () => {
  it("subscribes and unsubscribes account updates", () => {
    const api = createMockApi();
    const callback = vi.fn();

    const unsubscribe = createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    expect(api.reqAccountUpdates).toHaveBeenCalledWith(true, "DU123456");
    unsubscribe();
    expect(api.reqAccountUpdates).toHaveBeenCalledWith(false, "DU123456");
  });

  it("filters events using current accountId when passed as getter", () => {
    const api = createMockApi();
    const callback = vi.fn();
    let currentAccountId = "";

    createPortfolioSubscription({
      api,
      accountId: () => currentAccountId,
      callback,
    });

    // Before accountId is set, events from any account pass through
    api.emit(
      "updatePortfolio",
      { symbol: "AAPL", conId: 1, currency: "USD" },
      100, 150.0, 15000, 140.0, 1000, 0, "DU999999"
    );
    expect(callback).toHaveBeenCalledTimes(1);

    // Now accountId arrives (simulates late managedAccounts)
    currentAccountId = "DU123456";

    // Event from the correct account passes
    api.emit(
      "updatePortfolio",
      { symbol: "MSFT", conId: 2, currency: "USD" },
      50, 300.0, 15000, 280.0, 1000, 0, "DU123456"
    );
    expect(callback).toHaveBeenCalledTimes(2);

    // Event from a different account is now filtered
    api.emit(
      "updatePortfolio",
      { symbol: "GOOG", conId: 3, currency: "USD" },
      10, 100.0, 1000, 90.0, 100, 0, "DU999999"
    );
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("reattaches cached market hours when position is removed and re-added", () => {
    const api = createMockApi();
    const callback = vi.fn();

    createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    const contract = { symbol: "AAPL", conId: 265598, currency: "USD", exchange: "SMART", secType: "STK" };

    // 1. Add position — triggers reqContractDetails
    api.emit("updatePortfolio", contract, 100, 150.5, 15050, 145.0, 550, 0, "DU123456");
    expect(api.reqContractDetails).toHaveBeenCalledTimes(1);
    const reqId = api.reqContractDetails.mock.calls[0][0];

    // 2. Contract details arrive
    api.emit("contractDetails", reqId, {
      contract: { conId: 265598 },
      timeZoneId: "America/New_York",
      liquidHours: "20260210:0930-1600",
      tradingHours: "20260210:0400-2000",
    });
    api.emit("contractDetailsEnd", reqId);

    // 3. Remove position (qty=0)
    api.emit("updatePortfolio", contract, 0, 150.5, 0, 145.0, 0, 0, "DU123456");

    // 4. Re-add position
    api.emit("updatePortfolio", contract, 50, 155.0, 7750, 145.0, 500, 0, "DU123456");

    // No second reqContractDetails — cache hit
    expect(api.reqContractDetails).toHaveBeenCalledTimes(1);

    // Market hours should be reattached from cache
    const lastUpdate = callback.mock.calls.at(-1)?.[0];
    const position = lastUpdate.positions.find((p: { conId: number }) => p.conId === 265598);
    expect(position).toBeDefined();
    expect(position.marketHours).toEqual({
      timeZoneId: "America/New_York",
      liquidHours: "20260210:0930-1600",
      tradingHours: "20260210:0400-2000",
    });
  });
});
