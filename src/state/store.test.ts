import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStore } from "./store.js";
import type { PortfolioUpdate } from "../broker/types.js";
import { log } from "../utils/logger.js";

vi.mock("../broker/ibkr/index.js", () => {
  return {
    IBKRBroker: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(false),
      onDisconnect: vi.fn().mockReturnValue(vi.fn()),
      onStatus: vi.fn().mockReturnValue(vi.fn()),
      subscribePortfolio: vi.fn((callback: (update: PortfolioUpdate) => void) => {
        callback({
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
        });
        return vi.fn();
      }),
    })),
  };
});

vi.mock("../utils/logger.js", () => ({
  log: vi.fn(),
}));

describe("store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      connectionStatus: "disconnected",
      error: null,
      brokerStatus: null,
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
  });

  describe("subscribePortfolio", () => {
    it("updates positions state from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.positions).toHaveLength(1);
      expect(state.positions[0].symbol).toBe("AAPL");
      expect(state.positions[0].quantity).toBe(100);
    });

    it("updates totalEquity from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.totalEquity).toBe(20050);
    });

    it("updates positionsMarketValue from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.positionsMarketValue).toBe(15050);
    });

    it("updates lastPortfolioUpdateAt from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.lastPortfolioUpdateAt).toBe(1000);
    });

    it("updates cashBalancesByCurrency from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.cashBalancesByCurrency).toEqual({ USD: 5000 });
    });

    it("updates cash exchange-rate state from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.cashExchangeRatesByCurrency).toEqual({ USD: 1 });
      expect(state.baseCurrencyCode).toBe("USD");
    });

    it("returns an unsubscribe function", () => {
      const { subscribePortfolio } = useStore.getState();
      const unsubscribe = subscribePortfolio();

      expect(typeof unsubscribe).toBe("function");
    });

    it("logs state.snapshot when portfolio state changes", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      expect(log).toHaveBeenCalledWith(
        "debug",
        "state.snapshot",
        expect.stringContaining("positionsMV=15050.00")
      );
    });

    it("does not log duplicate state.snapshot for unchanged state", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();
      subscribePortfolio();

      expect(log).toHaveBeenCalledTimes(1);
    });

    it("derives available display currencies from portfolio update", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.availableDisplayCurrencies).toEqual(["USD"]);
    });

    it("resolves display currency to base when preference is BASE", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.displayCurrencyCode).toBe("USD");
      expect(state.displayCurrencyWarning).toBeNull();
    });
  });

  describe("cycleDisplayCurrency", () => {
    it("cycles deterministically through available currencies", () => {
      useStore.setState({
        baseCurrencyCode: "USD",
        availableDisplayCurrencies: ["EUR", "GBP", "USD"],
        displayCurrencyCode: "USD",
        displayCurrencyPreference: "BASE",
        cashExchangeRatesByCurrency: { EUR: 1.1, GBP: 1.3, USD: 1 },
      });

      const { cycleDisplayCurrency } = useStore.getState();

      // USD -> EUR (next, wraps because USD is at index 2)
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("EUR");

      // EUR -> GBP
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("GBP");

      // GBP -> USD
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyCode).toBe("USD");

      // USD -> GBP (prev)
      cycleDisplayCurrency("prev");
      expect(useStore.getState().displayCurrencyCode).toBe("GBP");
    });

    it("advances past unavailable currencies when cycling", () => {
      // EUR has no FX rate, JPY has FX rate. Cycling from USD should advance
      // to EUR (preference), then next cycle should advance to JPY (not get stuck on EUR).
      useStore.setState({
        baseCurrencyCode: "USD",
        availableDisplayCurrencies: ["EUR", "JPY", "USD"],
        displayCurrencyCode: "USD",
        displayCurrencyPreference: "BASE",
        cashExchangeRatesByCurrency: { JPY: 0.0067, USD: 1 },
        // Note: no EUR FX rate
      });

      const { cycleDisplayCurrency } = useStore.getState();

      // USD -> EUR (next): EUR is unavailable, falls back to USD display but preference is EUR
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyPreference).toBe("EUR");
      expect(useStore.getState().displayCurrencyCode).toBe("USD"); // fallback

      // EUR -> JPY (next): JPY IS available
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyPreference).toBe("JPY");
      expect(useStore.getState().displayCurrencyCode).toBe("JPY");

      // JPY -> USD (next)
      cycleDisplayCurrency("next");
      expect(useStore.getState().displayCurrencyPreference).toBe("BASE");
      expect(useStore.getState().displayCurrencyCode).toBe("USD");
    });

    it("falls back to base when preferred currency is not convertible", () => {
      useStore.setState({
        baseCurrencyCode: "USD",
        availableDisplayCurrencies: ["EUR", "USD"],
        displayCurrencyCode: "USD",
        displayCurrencyPreference: "BASE",
        cashExchangeRatesByCurrency: { USD: 1 },
      });

      // Set preference to EUR directly — but no EUR FX rate available
      useStore.getState().setDisplayCurrencyPreference("EUR");
      const state = useStore.getState();
      expect(state.displayCurrencyCode).toBe("USD");
      expect(state.displayCurrencyWarning).toContain("EUR");
    });
  });

  describe("disconnect", () => {
    it("resets portfolio state on disconnect", async () => {
      const { subscribePortfolio, disconnect } = useStore.getState();
      subscribePortfolio();

      await disconnect();

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

  describe("connect", () => {
    it("sets connectionStatus to connected on success", async () => {
      const { connect } = useStore.getState();
      await connect();

      const state = useStore.getState();
      expect(state.connectionStatus).toBe("connected");
    });

    it("sets connectionStatus to connecting during connection", async () => {
      const { connect } = useStore.getState();
      const connectPromise = connect();

      expect(useStore.getState().connectionStatus).toBe("connecting");

      await connectPromise;
    });
  });
});
