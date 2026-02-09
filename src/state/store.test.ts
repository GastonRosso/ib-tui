import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStore } from "./store.js";
import type { PortfolioUpdate } from "../broker/types.js";

vi.mock("../broker/ibkr/IBKRBroker.js", () => {
  return {
    IBKRBroker: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(false),
      onDisconnect: vi.fn().mockReturnValue(vi.fn()),
      subscribePortfolio: vi.fn((callback: (update: PortfolioUpdate) => void) => {
        callback({
          positions: [
            {
              symbol: "AAPL",
              quantity: 100,
              avgCost: 145.0,
              marketValue: 15050,
              unrealizedPnL: 550,
              dailyPnL: 75.25,
              realizedPnL: 0,
              marketPrice: 150.5,
              currency: "USD",
              conId: 265598,
            },
          ],
          positionsMarketValue: 15050,
          totalEquity: 20050,
          accountDailyPnL: 75.25,
          cashBalance: 5000,
          initialLoadComplete: true,
          positionPnlReady: true,
          accountPnlReady: true,
        });
        return vi.fn();
      }),
    })),
  };
});

describe("store", () => {
  beforeEach(() => {
    useStore.setState({
      connectionStatus: "disconnected",
      error: null,
      positions: [],
      positionsMarketValue: 0,
      totalEquity: 0,
      accountDailyPnL: 0,
      cashBalance: 0,
      positionPnlReady: false,
      accountPnlReady: false,
      marketValueHistory: [],
      chartStartTime: null,
      lastHistoryTimestamp: null,
      chartStartValue: null,
      initialLoadComplete: false,
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

    it("updates accountDailyPnL from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.accountDailyPnL).toBe(75.25);
    });

    it("updates pnl readiness flags from broker subscription", () => {
      const { subscribePortfolio } = useStore.getState();
      subscribePortfolio();

      const state = useStore.getState();
      expect(state.positionPnlReady).toBe(true);
      expect(state.accountPnlReady).toBe(true);
    });

    it("returns an unsubscribe function", () => {
      const { subscribePortfolio } = useStore.getState();
      const unsubscribe = subscribePortfolio();

      expect(typeof unsubscribe).toBe("function");
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
      expect(state.accountDailyPnL).toBe(0);
      expect(state.positionPnlReady).toBe(false);
      expect(state.accountPnlReady).toBe(false);
      expect(state.connectionStatus).toBe("disconnected");
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
