import { describe, expect, it, vi } from "vitest";
import EventEmitter from "events";
import { createPortfolioSubscription } from "./createPortfolioSubscription.js";

const createMockApi = () =>
  Object.assign(new EventEmitter(), {
    reqAccountUpdates: vi.fn(),
    reqContractDetails: vi.fn(),
    reqMktData: vi.fn(),
    cancelMktData: vi.fn(),
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

  it("subscribes to FX for non-base position currency after account download", () => {
    const api = createMockApi();
    const callback = vi.fn();

    createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    // Detect base currency
    api.emit("updateAccountValue", "TotalCashValue", "1000", "USD", "DU123456");

    // Position in EUR (non-base)
    api.emit(
      "updatePortfolio",
      { symbol: "SAP", conId: 100, currency: "EUR", exchange: "SMART", secType: "STK" },
      50, 200.0, 10000, 180.0, 1000, 0, "DU123456"
    );

    // Before accountDownloadEnd — no FX subscriptions yet
    expect(api.reqMktData).toHaveBeenCalledTimes(0);

    api.emit("accountDownloadEnd", "DU123456");

    // After accountDownloadEnd — FX subscription for EUR
    expect(api.reqMktData).toHaveBeenCalledTimes(1);
    const call = api.reqMktData.mock.calls[0];
    expect(call[1]).toMatchObject({ symbol: "EUR", currency: "USD", exchange: "IDEALPRO", secType: "CASH" });
  });

  it("creates only one FX subscription for currency shared by cash and position", () => {
    const api = createMockApi();
    const callback = vi.fn();

    createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    api.emit("updateAccountValue", "TotalCashValue", "1000", "USD", "DU123456");

    // EUR cash balance
    api.emit("updateAccountValue", "TotalCashBalance", "500", "EUR", "DU123456");

    // EUR position
    api.emit(
      "updatePortfolio",
      { symbol: "SAP", conId: 100, currency: "EUR", exchange: "SMART", secType: "STK" },
      50, 200.0, 10000, 180.0, 1000, 0, "DU123456"
    );

    api.emit("accountDownloadEnd", "DU123456");

    // Only 1 FX subscription even though EUR appears in both cash and positions
    expect(api.reqMktData).toHaveBeenCalledTimes(1);
  });

  it("subscribes to IDEALPRO FX and updates converted cash from live ticks", () => {
    const api = createMockApi();
    const callback = vi.fn();

    const unsubscribe = createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    api.emit("updateAccountValue", "TotalCashValue", "1000", "USD", "DU123456");
    api.emit("updateAccountValue", "TotalCashBalance", "500", "EUR", "DU123456");
    api.emit("accountDownloadEnd", "DU123456");

    expect(api.reqMktData).toHaveBeenCalledTimes(1);
    const [reqId] = api.reqMktData.mock.calls[0];

    api.emit("tickPrice", reqId, 1, 1.1, true);
    api.emit("tickPrice", reqId, 2, 1.3, true);

    const lastUpdate = callback.mock.calls.at(-1)?.[0];
    expect(lastUpdate.cashBalancesByCurrency.EUR).toBeCloseTo(600, 6);

    unsubscribe();
    expect(api.cancelMktData).toHaveBeenCalledWith(reqId);
  });

  it("live FX rate survives stale static ExchangeRate overwrite", () => {
    const api = createMockApi();
    const callback = vi.fn();

    createPortfolioSubscription({
      api,
      accountId: "DU123456",
      callback,
    });

    // Set up: base=USD, EUR cash balance=500
    api.emit("updateAccountValue", "TotalCashValue", "1000", "USD", "DU123456");
    api.emit("updateAccountValue", "TotalCashBalance", "500", "EUR", "DU123456");
    api.emit("accountDownloadEnd", "DU123456");

    const [reqId] = api.reqMktData.mock.calls[0];

    // Step 1: Live ticks arrive → mid rate=1.2, converted cash=600
    api.emit("tickPrice", reqId, 1, 1.1, true);  // bid
    api.emit("tickPrice", reqId, 2, 1.3, true);  // ask
    const afterLive = callback.mock.calls.at(-1)?.[0];
    expect(afterLive.cashBalancesByCurrency.EUR).toBeCloseTo(600, 6);

    // Step 2: Stale static ExchangeRate arrives at 1.0 → overwrites projection
    api.emit("updateAccountValue", "ExchangeRate", "1.0", "EUR", "DU123456");
    const afterStatic = callback.mock.calls.at(-1)?.[0];
    expect(afterStatic.cashBalancesByCurrency.EUR).toBeCloseTo(500, 6);

    // Step 3: Same live ticks arrive again (rate=1.2, same as step 1)
    // Without the fix, these would be deduped and projection stays at stale 1.0
    api.emit("tickPrice", reqId, 1, 1.1, true);  // bid
    api.emit("tickPrice", reqId, 2, 1.3, true);  // ask
    const afterLiveAgain = callback.mock.calls.at(-1)?.[0];
    expect(afterLiveAgain.cashBalancesByCurrency.EUR).toBeCloseTo(600, 6);
  });
});
