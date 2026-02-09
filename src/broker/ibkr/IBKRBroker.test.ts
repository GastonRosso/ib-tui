import { describe, it, expect, vi, beforeEach } from "vitest";
import EventEmitter from "events";

vi.mock("./debug.js", () => ({
  debugLog: vi.fn(),
}));

vi.mock("@stoqey/ib", async () => {
  const events = await import("events");

  const MockEventName = {
    connected: "connected",
    disconnected: "disconnected",
    nextValidId: "nextValidId",
    error: "error",
    managedAccounts: "managedAccounts",
    updatePortfolio: "updatePortfolio",
    updateAccountValue: "updateAccountValue",
    accountDownloadEnd: "accountDownloadEnd",
    pnl: "pnl",
    pnlSingle: "pnlSingle",
  };

  class MockIBApiClass extends events.EventEmitter {
    connect = vi.fn();
    disconnect = vi.fn();
    cancelOrder = vi.fn();
    reqAccountUpdates = vi.fn();
    reqPnL = vi.fn();
    reqPnLSingle = vi.fn();
    cancelPnL = vi.fn();
    cancelPnLSingle = vi.fn();
  }

  return {
    IBApi: MockIBApiClass,
    EventName: MockEventName,
    Contract: class {},
  };
});

import { IBKRBroker } from "./IBKRBroker.js";
import { EventName } from "@stoqey/ib";

describe("IBKRBroker", () => {
  let broker: IBKRBroker;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = new IBKRBroker();
  });

  describe("subscribePortfolio", () => {
    let mockApi: EventEmitter & {
      reqAccountUpdates: ReturnType<typeof vi.fn>;
      reqPnL: ReturnType<typeof vi.fn>;
      reqPnLSingle: ReturnType<typeof vi.fn>;
      cancelPnL: ReturnType<typeof vi.fn>;
      cancelPnLSingle: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      const connectPromise = broker.connect({ host: "127.0.0.1", port: 4002, clientId: 1 });
      mockApi = (broker as unknown as { api: typeof mockApi }).api;
      mockApi.emit(EventName.nextValidId, 1);
      await connectPromise;
      mockApi.emit(EventName.managedAccounts, "DU123456");
    });

    it("returns an unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = broker.subscribePortfolio(callback);

      expect(typeof unsubscribe).toBe("function");
    });

    it("subscribes to account updates and PnL", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      expect(mockApi.reqAccountUpdates).toHaveBeenCalledWith(true, "DU123456");
      expect(mockApi.reqPnL).toHaveBeenCalledWith(expect.any(Number), "DU123456", "");
    });

    it("calls callback with position updates", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      expect(callback).toHaveBeenCalledWith({
        positions: [
          expect.objectContaining({
            symbol: "AAPL",
            quantity: 100,
            marketPrice: 150.5,
            marketValue: 15050,
            avgCost: 145.0,
            unrealizedPnL: 550,
            conId: 265598,
            currency: "USD",
          }),
        ],
        positionsMarketValue: 15050,
        totalEquity: 15050,
        accountDailyPnL: 0,
        cashBalance: 0,
        initialLoadComplete: false,
        positionPnlReady: false,
        accountPnlReady: false,
      });
    });

    it("calls callback with account PnL updates", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const pnlReqId = mockApi.reqPnL.mock.calls[0][0];
      mockApi.emit(EventName.pnl, pnlReqId, 250.5, 1000, 500);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          accountDailyPnL: 250.5,
          accountPnlReady: true,
        })
      );
    });

    it("requests single PnL for each position", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      expect(mockApi.reqPnLSingle).toHaveBeenCalledWith(
        expect.any(Number),
        "DU123456",
        "",
        265598
      );
    });

    it("updates position with single PnL data", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const pnlSingleReqId = mockApi.reqPnLSingle.mock.calls[0][0];
      mockApi.emit(EventName.pnlSingle, pnlSingleReqId, 100, 75.25, 550, 0, 12345);

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.positions[0].dailyPnL).toBe(75.25);
      // market value updates from pnlSingle for near-1s responsiveness
      expect(lastCall.positions[0].marketValue).toBe(12345);
      expect(lastCall.positions[0].marketPrice).toBe(123.45);
      expect(lastCall.positionPnlReady).toBe(true);
    });

    it("uses pnlSingle market value while preserving updatePortfolio as fallback source", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const pnlSingleReqId = mockApi.reqPnLSingle.mock.calls[0][0];
      mockApi.emit(EventName.pnlSingle, pnlSingleReqId, 100, 10, 550, 0, 14900);

      const afterPnlSingle = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(afterPnlSingle.positions[0].marketValue).toBe(14900);

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        151.0,
        15100,
        145.0,
        600,
        0,
        "DU123456"
      );

      const afterPortfolioUpdate = callback.mock.calls[callback.mock.calls.length - 1][0];
      // qty unchanged and pnlSingle active -> keep realtime overlay
      expect(afterPortfolioUpdate.positions[0].marketValue).toBe(14900);
      expect(afterPortfolioUpdate.positions[0].marketPrice).toBe(149.0);

      // when qty changes, canonical updatePortfolio value becomes baseline again
      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        90,
        151.0,
        13590,
        145.0,
        600,
        0,
        "DU123456"
      );

      const afterQtyChange = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(afterQtyChange.positions[0].marketValue).toBe(13590);
      expect(afterQtyChange.positions[0].marketPrice).toBe(151.0);
    });

    it("falls back to updatePortfolio market value when pnlSingle becomes stale", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const nowSpy = vi.spyOn(Date, "now");

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      nowSpy.mockReturnValue(1000);
      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const pnlSingleReqId = mockApi.reqPnLSingle.mock.calls[0][0];
      nowSpy.mockReturnValue(1500);
      mockApi.emit(EventName.pnlSingle, pnlSingleReqId, 100, 10, 550, 0, 14900);

      nowSpy.mockReturnValue(6000);
      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        151.0,
        15100,
        145.0,
        600,
        0,
        "DU123456"
      );

      const latest = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(latest.positions[0].marketValue).toBe(15100);
      expect(latest.positions[0].marketPrice).toBe(151.0);
      nowSpy.mockRestore();
    });

    it("removes position when quantity becomes zero", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        0,
        150.5,
        0,
        145.0,
        0,
        0,
        "DU123456"
      );

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.positions).toHaveLength(0);
      expect(lastCall.positionsMarketValue).toBe(0);
      expect(lastCall.totalEquity).toBe(0);
    });

    it("cleans up subscriptions on unsubscribe", () => {
      const callback = vi.fn();
      const unsubscribe = broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const pnlReqId = mockApi.reqPnL.mock.calls[0][0];

      unsubscribe();

      expect(mockApi.reqAccountUpdates).toHaveBeenCalledWith(false, "DU123456");
      expect(mockApi.cancelPnL).toHaveBeenCalledWith(pnlReqId);
      expect(mockApi.cancelPnLSingle).toHaveBeenCalled();
    });

    it("ignores updates from other accounts", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "OTHER_ACCOUNT"
      );

      expect(callback).not.toHaveBeenCalled();
    });

    it("tracks NetLiquidation but keeps totalEquity as positions + cash for live cadence", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      // Set NetLiquidation
      mockApi.emit(EventName.updateAccountValue, "NetLiquidation", "25000.50", "BASE", "DU123456");

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.totalEquity).toBe(15050);
      expect(lastCall.positionsMarketValue).toBe(15050);
    });

    it("falls back to positionsMarketValue + cashBalance when NetLiquidation is absent", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      mockApi.emit(EventName.updateAccountValue, "TotalCashBalance", "5000", "BASE", "DU123456");

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.totalEquity).toBe(20050);
      expect(lastCall.positionsMarketValue).toBe(15050);
      expect(lastCall.cashBalance).toBe(5000);
    });

    it("sets accountPnlReady after first pnl tick", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      // Before pnl tick, accountPnlReady should be false
      const beforePnl = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(beforePnl.accountPnlReady).toBe(false);

      // After pnl tick, accountPnlReady should be true
      const pnlReqId = mockApi.reqPnL.mock.calls[0][0];
      mockApi.emit(EventName.pnl, pnlReqId, 250.5, 1000, 500);

      const afterPnl = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(afterPnl.accountPnlReady).toBe(true);
    });

    it("sets positionPnlReady after first pnlSingle tick", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const beforePnLSingle = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(beforePnLSingle.positionPnlReady).toBe(false);

      const pnlSingleReqId = mockApi.reqPnLSingle.mock.calls[0][0];
      mockApi.emit(EventName.pnlSingle, pnlSingleReqId, 100, 75.25, 550, 0, 15000);

      const afterPnLSingle = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(afterPnLSingle.positionPnlReady).toBe(true);
    });

    it("sets initialLoadComplete on accountDownloadEnd", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      mockApi.emit(
        EventName.updatePortfolio,
        contract,
        100,
        150.5,
        15050,
        145.0,
        550,
        0,
        "DU123456"
      );

      const beforeEnd = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(beforeEnd.initialLoadComplete).toBe(false);

      mockApi.emit(EventName.accountDownloadEnd, "DU123456");

      const afterEnd = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(afterEnd.initialLoadComplete).toBe(true);
    });
  });
});
