import { describe, it, expect, vi, beforeEach } from "vitest";
import EventEmitter from "events";

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
        totalPortfolioValue: 15050,
        accountDailyPnL: 0,
        cashBalance: 0,
        initialLoadComplete: false,
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
      // market value stays sourced from updatePortfolio
      expect(lastCall.positions[0].marketValue).toBe(15050);
      expect(lastCall.positions[0].marketPrice).toBe(150.5);
    });

    it("keeps market value from updatePortfolio even when pnlSingle value differs", () => {
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
      expect(afterPnlSingle.positions[0].marketValue).toBe(15050);

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
      expect(afterPortfolioUpdate.positions[0].marketValue).toBe(15100);
      expect(afterPortfolioUpdate.positions[0].marketPrice).toBe(151.0);
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
      expect(lastCall.totalPortfolioValue).toBe(0);
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
  });
});
