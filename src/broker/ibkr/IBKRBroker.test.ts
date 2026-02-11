import { describe, it, expect, vi, beforeEach } from "vitest";
import type EventEmitter from "events";

vi.mock("../../utils/logger.js", () => ({
  log: vi.fn(),
  isLogLevelEnabled: vi.fn(() => true),
}));

vi.mock("@stoqey/ib", async () => {
  const events = await import("events");

  const MockEventName = {
    connected: "connected",
    disconnected: "disconnected",
    nextValidId: "nextValidId",
    error: "error",
    info: "info",
    sent: "sent",
    received: "received",
    all: "all",
    managedAccounts: "managedAccounts",
    updatePortfolio: "updatePortfolio",
    updateAccountValue: "updateAccountValue",
    updateAccountTime: "updateAccountTime",
    accountDownloadEnd: "accountDownloadEnd",
    contractDetails: "contractDetails",
    contractDetailsEnd: "contractDetailsEnd",
    tickPrice: "tickPrice",
    tickSize: "tickSize",
    tickGeneric: "tickGeneric",
    tickString: "tickString",
    tickReqParams: "tickReqParams",
    tickSnapshotEnd: "tickSnapshotEnd",
  };

  class MockIBApiClass extends events.EventEmitter {
    connect = vi.fn();
    disconnect = vi.fn();
    cancelOrder = vi.fn();
    reqAccountUpdates = vi.fn();
    reqContractDetails = vi.fn();
    reqMktData = vi.fn();
    cancelMktData = vi.fn();
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

  describe("status events", () => {
    let mockApi: EventEmitter;

    beforeEach(async () => {
      const connectPromise = broker.connect({ host: "127.0.0.1", port: 4002, clientId: 1 });
      const maybeApi = Reflect.get(broker, "api");
      if (!maybeApi) throw new Error("Expected api to be initialized after connect()");
      mockApi = maybeApi;
      mockApi.emit(EventName.nextValidId, 1);
      await connectPromise;
    });

    it("emits farm connectivity info events as broker status", () => {
      const callback = vi.fn();
      broker.onStatus(callback);

      mockApi.emit(EventName.info, "Market data farm connection is broken:eufarm", 2103);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          code: 2103,
          message: "Market data farm connection is broken:eufarm",
          at: expect.any(Number),
        })
      );
    });

    it("emits API errors as broker status", () => {
      const callback = vi.fn();
      broker.onStatus(callback);

      mockApi.emit(EventName.error, new Error("Permission denied"), 201, 700001);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          code: 201,
          reqId: 700001,
          message: "Permission denied",
          at: expect.any(Number),
        })
      );
    });
  });

  describe("subscribePortfolio", () => {
    let mockApi: EventEmitter & {
      reqAccountUpdates: ReturnType<typeof vi.fn>;
      reqContractDetails: ReturnType<typeof vi.fn>;
      reqMktData: ReturnType<typeof vi.fn>;
      cancelMktData: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      const connectPromise = broker.connect({ host: "127.0.0.1", port: 4002, clientId: 1 });
      const maybeApi = Reflect.get(broker, "api");
      if (!maybeApi) throw new Error("Expected api to be initialized after connect()");
      mockApi = maybeApi;
      mockApi.emit(EventName.nextValidId, 1);
      await connectPromise;
      mockApi.emit(EventName.managedAccounts, "DU123456");
    });

    it("returns an unsubscribe function", () => {
      const callback = vi.fn();
      const unsubscribe = broker.subscribePortfolio(callback);

      expect(typeof unsubscribe).toBe("function");
    });

    it("subscribes to account updates only", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      expect(mockApi.reqAccountUpdates).toHaveBeenCalledWith(true, "DU123456");
    });

    it("does not subscribe to pnl or pnlSingle", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      expect(mockApi).not.toHaveProperty("reqPnL");
      expect(mockApi).not.toHaveProperty("reqPnLSingle");
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

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
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
          cashBalance: 0,
          cashBalancesByCurrency: {},
          initialLoadComplete: false,
        })
      );
    });

    it("uses updatePortfolio market value directly without overlay", () => {
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
        100,
        151.0,
        15100,
        145.0,
        600,
        0,
        "DU123456"
      );

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.positions[0].marketValue).toBe(15100);
      expect(lastCall.positions[0].marketPrice).toBe(151.0);
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

      unsubscribe();

      expect(mockApi.reqAccountUpdates).toHaveBeenCalledWith(false, "DU123456");
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

    it("ignores NetLiquidation account updates", () => {
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
      const callsBefore = callback.mock.calls.length;

      mockApi.emit(EventName.updateAccountValue, "NetLiquidation", "25000.50", "BASE", "DU123456");

      expect(callback.mock.calls.length).toBe(callsBefore);
    });

    it("computes totalEquity as positionsMarketValue + cashBalance", () => {
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
      expect(lastCall.cashBalancesByCurrency).toEqual({});
    });

    it("captures cash balances by currency from account updates", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      mockApi.emit(EventName.updateAccountValue, "ExchangeRate", "1.00", "USD", "DU123456");
      mockApi.emit(EventName.updateAccountValue, "ExchangeRate", "1.20", "EUR", "DU123456");
      mockApi.emit(EventName.updateAccountValue, "TotalCashBalance", "1200.50", "USD", "DU123456");
      mockApi.emit(EventName.updateAccountValue, "TotalCashBalance", "350.25", "EUR", "DU123456");
      mockApi.emit(EventName.updateAccountValue, "TotalCashBalance", "1600.75", "BASE", "DU123456");

      const lastCall = callback.mock.calls.at(-1)?.[0];
      expect(lastCall.cashBalance).toBe(1600.75);
      expect(lastCall.cashBalancesByCurrency).toEqual({
        EUR: 420.3,
        USD: 1200.5,
      });
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

    it("includes lastPortfolioUpdateAt in every emit", () => {
      const callback = vi.fn();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

      broker.subscribePortfolio(callback);

      const contract = {
        symbol: "AAPL",
        conId: 265598,
        currency: "USD",
      };

      nowSpy.mockReturnValue(5000);
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

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.lastPortfolioUpdateAt).toBe(5000);
      nowSpy.mockRestore();
    });

    it("updates lastPortfolioUpdateAt on account value changes", () => {
      const callback = vi.fn();
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

      broker.subscribePortfolio(callback);

      nowSpy.mockReturnValue(8000);
      mockApi.emit(EventName.updateAccountValue, "TotalCashBalance", "5000", "BASE", "DU123456");

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.lastPortfolioUpdateAt).toBe(8000);
      nowSpy.mockRestore();
    });

    it("requests contract details and enriches positions with marketHours", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      mockApi.emit(
        EventName.updatePortfolio,
        { symbol: "AAPL", conId: 265598, currency: "USD", exchange: "SMART", secType: "STK" },
        100, 150.5, 15050, 145.0, 550, 0, "DU123456"
      );

      expect(mockApi.reqContractDetails).toHaveBeenCalledTimes(1);
      const [reqId] = mockApi.reqContractDetails.mock.calls[0];

      mockApi.emit(EventName.contractDetails, reqId, {
        contract: { conId: 265598 },
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: "20260210:0400-2000;20260211:0400-2000",
      });
      mockApi.emit(EventName.contractDetailsEnd, reqId);

      const lastCall = callback.mock.calls.at(-1)?.[0];
      expect(lastCall.positions[0].marketHours).toEqual({
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: "20260210:0400-2000;20260211:0400-2000",
      });
    });

    it("computes correct positionsMarketValue across multiple positions", () => {
      const callback = vi.fn();
      broker.subscribePortfolio(callback);

      mockApi.emit(
        EventName.updatePortfolio,
        { symbol: "AAPL", conId: 1, currency: "USD" },
        100, 150.0, 15000, 140.0, 1000, 0, "DU123456"
      );

      mockApi.emit(
        EventName.updatePortfolio,
        { symbol: "MSFT", conId: 2, currency: "USD" },
        50, 300.0, 15000, 280.0, 1000, 0, "DU123456"
      );

      const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0];
      expect(lastCall.positions).toHaveLength(2);
      expect(lastCall.positionsMarketValue).toBe(30000);
      expect(lastCall.totalEquity).toBe(30000);
    });
  });
});
