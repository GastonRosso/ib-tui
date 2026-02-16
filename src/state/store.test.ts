import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrokerStatus, PortfolioUpdate } from "../broker/types.js";
import { log } from "../utils/logger.js";
import { useStore } from "./store.js";

const brokerMocks = vi.hoisted(() => {
  const statusCallbacks = new Set<(status: BrokerStatus) => void>();
  const disconnectCallbacks = new Set<() => void>();

  const samplePortfolioUpdate: PortfolioUpdate = {
    positions: [
      {
        symbol: "AAPL",
        quantity: 100,
        avgCost: 145.0,
        marketValue: 15050,
        unrealizedPnL: 550,
        dailyPnL: 0,
        realizedPnL: 0,
        marketPrice: 150.5,
        currency: "USD",
        conId: 265598,
        marketValueBase: 15050,
        unrealizedPnLBase: 550,
        fxRateToBase: 1,
        isFxPending: false,
      },
    ],
    positionsMarketValue: 15050,
    positionsUnrealizedPnL: 550,
    totalEquity: 20050,
    cashBalance: 5000,
    cashBalancesByCurrency: { USD: 5000 },
    cashExchangeRatesByCurrency: { USD: 1 },
    baseCurrencyCode: "USD",
    initialLoadComplete: true,
    lastPortfolioUpdateAt: 1000,
    positionsPendingFxCount: 0,
    positionsPendingFxByCurrency: {},
  };

  const connect = vi.fn(async () => undefined);
  const disconnect = vi.fn(async () => undefined);
  const isConnected = vi.fn(() => false);
  const onDisconnect = vi.fn((callback: () => void) => {
    disconnectCallbacks.add(callback);
    return () => {
      disconnectCallbacks.delete(callback);
    };
  });
  const onStatus = vi.fn((callback: (status: BrokerStatus) => void) => {
    statusCallbacks.add(callback);
    return () => {
      statusCallbacks.delete(callback);
    };
  });
  const subscribePortfolio = vi.fn((callback: (update: PortfolioUpdate) => void) => {
    callback(samplePortfolioUpdate);
    return vi.fn();
  });

  const broker = {
    connect,
    disconnect,
    isConnected,
    onDisconnect,
    onStatus,
    subscribePortfolio,
  };

  return {
    statusCallbacks,
    disconnectCallbacks,
    samplePortfolioUpdate,
    connect,
    disconnect,
    isConnected,
    onDisconnect,
    onStatus,
    subscribePortfolio,
    broker,
  };
});

vi.mock("../broker/ibkr/index.js", () => {
  return {
    IBKRBroker: vi.fn().mockImplementation(() => brokerMocks.broker),
  };
});

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

const emitStatus = (status: BrokerStatus): void => {
  brokerMocks.statusCallbacks.forEach((callback) => callback(status));
};

const emitDisconnect = (): void => {
  brokerMocks.disconnectCallbacks.forEach((callback) => callback());
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    brokerMocks.statusCallbacks.clear();
    brokerMocks.disconnectCallbacks.clear();
    brokerMocks.connect.mockReset();
    brokerMocks.connect.mockResolvedValue(undefined);
    brokerMocks.disconnect.mockReset();
    brokerMocks.disconnect.mockResolvedValue(undefined);
    brokerMocks.isConnected.mockReset();
    brokerMocks.isConnected.mockReturnValue(false);

    useStore.setState({
      connectionStatus: "disconnected",
      connectionHealth: "down",
      error: null,
      brokerStatus: null,
      retryAttempt: 0,
      nextRetryAt: null,
      statusHistory: [],
      statusHistoryIndex: 0,
      positions: [],
      positionsMarketValue: 0,
      positionsUnrealizedPnL: 0,
      totalEquity: 0,
      cashBalance: 0,
      cashBalancesByCurrency: {},
      cashExchangeRatesByCurrency: {},
      baseCurrencyCode: null,
      initialLoadComplete: false,
      lastPortfolioUpdateAt: null,
      positionsPendingFxCount: 0,
      positionsPendingFxByCurrency: {},
      displayCurrencyPreference: "BASE",
      displayCurrencyCode: null,
      displayFxRate: 1,
      availableDisplayCurrencies: [],
      displayCurrencyWarning: null,
    });

    useStore.getState().stopAutoConnect();
  });

  afterEach(() => {
    useStore.getState().stopAutoConnect();
    vi.useRealTimers();
  });

  describe("subscribePortfolio", () => {
    it("updates portfolio state from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0].symbol).toBe("AAPL");
      expect(state.totalEquity).toBe(20050);
      expect(state.positionsMarketValue).toBe(15050);
      expect(state.lastPortfolioUpdateAt).toBe(1000);
      expect(state.cashBalancesByCurrency).toEqual({ USD: 5000 });
      expect(state.cashExchangeRatesByCurrency).toEqual({ USD: 1 });
      expect(state.baseCurrencyCode).toBe("USD");
      expect(state.availableDisplayCurrencies).toEqual(["USD"]);
      expect(state.displayCurrencyCode).toBe("USD");
      expect(state.displayCurrencyWarning).toBeNull();
    });

    it("logs state.snapshot when portfolio state changes", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      expect(log).toHaveBeenCalledWith(
        "debug",
        "state.snapshot",
        expect.stringContaining("positionsMV=15050.00"),
      );
    });

    it("does not log duplicate state.snapshot for unchanged state", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();
      subscribePortfolio();

      expect(log).toHaveBeenCalledTimes(1);
    });
  });

  describe("display currency", () => {
    it("cycles deterministically through available currencies", () => {
      useStore.setState({
        baseCurrencyCode: "USD",
        availableDisplayCurrencies: ["EUR", "GBP", "USD"],
        displayCurrencyCode: "USD",
        displayCurrencyPreference: "BASE",
        cashExchangeRatesByCurrency: { EUR: 1.1, GBP: 1.3, USD: 1 },
      });

      const { cycleDisplayCurrency } = useStore.getState();

      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("EUR");

      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("GBP");

      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("USD");

      cycleDisplayCurrency("prev");
      expect(useStore.getState().displayCurrencyCode).toBe("GBP");
    });

    it("falls back to base when preferred currency is not convertible", () => {
      useStore.setState({
        baseCurrencyCode: "USD",
        availableDisplayCurrencies: ["EUR", "USD"],
        displayCurrencyCode: "USD",
        displayCurrencyPreference: "BASE",
        cashExchangeRatesByCurrency: { USD: 1 },
      });

      useStore.getState().setDisplayCurrencyPreference("EUR");
      const state = useStore.getState();
      expect(state.displayCurrencyCode).toBe("USD");
      expect(state.displayCurrencyWarning).toContain("EUR");
    });
  });

  describe("connection flow", () => {
    it("sets connectionStatus to connected and health to healthy on success", async () => {
      await useStore.getState().connect();

      const state = useStore.getState();
      expect(state.connectionStatus).toBe("connected");
      expect(state.connectionHealth).toBe("healthy");
      expect(state.retryAttempt).toBe(0);
      expect(state.nextRetryAt).toBeNull();
    });

    it("sets connectionStatus to connecting while connect is in-flight", async () => {
      let releaseConnect!: () => void;
      brokerMocks.connect.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            releaseConnect = () => resolve(undefined);
          }),
      );

      const promise = useStore.getState().connect();
      expect(useStore.getState().connectionStatus).toBe("connecting");

      releaseConnect();
      await promise;
    });

    it("keeps transport connected but marks health degraded on code 1100", async () => {
      await useStore.getState().connect();

      emitStatus({
        level: "error",
        code: 1100,
        message: "Connectivity between IBKR and Trader Workstation has been lost.",
        at: Date.now(),
      });

      const state = useStore.getState();
      expect(state.connectionStatus).toBe("connected");
      expect(state.connectionHealth).toBe("degraded");
      expect(state.brokerStatus?.code).toBe(1100);
    });

    it("returns health to healthy on recovery info code", async () => {
      await useStore.getState().connect();

      emitStatus({
        level: "error",
        code: 1100,
        message: "Connectivity between IBKR and Trader Workstation has been lost.",
        at: Date.now(),
      });
      emitStatus({
        level: "info",
        code: 1101,
        message: "Connectivity between IBKR and Trader Workstation has been restored.",
        at: Date.now() + 1000,
      });

      expect(useStore.getState().connectionHealth).toBe("healthy");
    });

    it("does not degrade health for HMDS inactive warn code 2107", async () => {
      await useStore.getState().connect();

      emitStatus({
        level: "warn",
        code: 2107,
        message:
          "HMDS data farm connection is inactive but should be available upon demand.",
        at: Date.now(),
      });

      expect(useStore.getState().connectionStatus).toBe("connected");
      expect(useStore.getState().connectionHealth).toBe("healthy");
    });

    it("keeps last portfolio snapshot when transport disconnects", async () => {
      useStore.getState().subscribePortfolio();
      await useStore.getState().connect();

      emitDisconnect();

      const state = useStore.getState();
      expect(state.connectionStatus).toBe("disconnected");
      expect(state.connectionHealth).toBe("down");
      expect(state.error).toBe("Connection lost");
      expect(state.positions).toHaveLength(1);
      expect(state.totalEquity).toBe(20050);
      expect(state.lastPortfolioUpdateAt).toBe(1000);
    });

    it("auto-retries with backoff after startup failure", async () => {
      vi.useFakeTimers();
      brokerMocks.connect.mockRejectedValue(new Error("Connection timeout"));

      useStore.getState().startAutoConnect();
      await flushMicrotasks();

      expect(brokerMocks.connect).toHaveBeenCalledTimes(1);
      expect(useStore.getState().connectionStatus).toBe("error");
      expect(useStore.getState().retryAttempt).toBe(1);
      expect(useStore.getState().nextRetryAt).not.toBeNull();

      vi.advanceTimersByTime(1000);
      await flushMicrotasks();

      expect(brokerMocks.connect).toHaveBeenCalledTimes(2);
      expect(useStore.getState().retryAttempt).toBe(2);
    });

    it("resets retry metadata after successful reconnect", async () => {
      vi.useFakeTimers();
      brokerMocks.connect
        .mockRejectedValueOnce(new Error("Connection timeout"))
        .mockResolvedValueOnce(undefined);

      useStore.getState().startAutoConnect();
      await flushMicrotasks();

      expect(useStore.getState().retryAttempt).toBe(1);

      vi.advanceTimersByTime(1000);
      await flushMicrotasks();

      const state = useStore.getState();
      expect(state.connectionStatus).toBe("connected");
      expect(state.connectionHealth).toBe("healthy");
      expect(state.retryAttempt).toBe(0);
      expect(state.nextRetryAt).toBeNull();
    });
  });

  describe("status history", () => {
    it("dedupes consecutive equivalent events within 10 seconds", async () => {
      await useStore.getState().connect();

      emitStatus({
        level: "error",
        code: 1100,
        message: "Connectivity between IBKR and Trader Workstation has been lost.",
        at: 1_000,
      });
      emitStatus({
        level: "error",
        code: 1100,
        message: "Connectivity between IBKR and Trader Workstation has been lost.",
        at: 9_000,
      });

      const state = useStore.getState();
      expect(state.statusHistory).toHaveLength(1);
      expect(state.statusHistory[0].repeatCount).toBe(2);
      expect(state.statusHistoryIndex).toBe(0);
    });

    it("caps history at 1000 events", async () => {
      await useStore.getState().connect();

      for (let i = 0; i < 1_050; i += 1) {
        emitStatus({
          level: "error",
          message: `error ${i}`,
          at: 20_000 + i,
        });
      }

      const state = useStore.getState();
      expect(state.statusHistory).toHaveLength(1000);
      expect(state.statusHistory[0].message).toBe("error 50");
      expect(state.statusHistory.at(-1)?.message).toBe("error 1049");
    });

    it("keeps cursor when browsing older entries and new status arrives", async () => {
      await useStore.getState().connect();

      emitStatus({ level: "error", message: "error 1", at: 20_000 });
      emitStatus({ level: "error", message: "error 2", at: 30_000 });
      emitStatus({ level: "error", message: "error 3", at: 40_000 });

      useStore.getState().selectOlderStatus();
      expect(useStore.getState().statusHistoryIndex).toBe(1);

      emitStatus({ level: "error", message: "error 4", at: 50_000 });

      expect(useStore.getState().statusHistoryIndex).toBe(1);
    });

    it("respects oldest/newest history boundaries", async () => {
      await useStore.getState().connect();

      emitStatus({ level: "error", message: "error 1", at: 20_000 });
      emitStatus({ level: "error", message: "error 2", at: 30_000 });

      useStore.getState().selectOlderStatus();
      useStore.getState().selectOlderStatus();
      useStore.getState().selectOlderStatus();
      expect(useStore.getState().statusHistoryIndex).toBe(0);

      useStore.getState().selectNewerStatus();
      useStore.getState().selectNewerStatus();
      useStore.getState().selectNewerStatus();
      expect(useStore.getState().statusHistoryIndex).toBe(1);
    });
  });

  describe("manual disconnect", () => {
    it("resets portfolio state on disconnect", async () => {
      useStore.getState().subscribePortfolio();

      await useStore.getState().disconnect();

      const state = useStore.getState();
      expect(state.positions).toHaveLength(0);
      expect(state.totalEquity).toBe(0);
      expect(state.positionsMarketValue).toBe(0);
      expect(state.cashBalance).toBe(0);
      expect(state.cashBalancesByCurrency).toEqual({});
      expect(state.cashExchangeRatesByCurrency).toEqual({});
      expect(state.baseCurrencyCode).toBeNull();
      expect(state.lastPortfolioUpdateAt).toBeNull();
      expect(state.connectionStatus).toBe("disconnected");
      expect(state.displayCurrencyCode).toBeNull();
      expect(state.availableDisplayCurrencies).toEqual([]);
    });
  });
});
