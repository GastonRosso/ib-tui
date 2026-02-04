import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/IBKRBroker.js";
import type { Broker, Position } from "../broker/types.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  error: string | null;
  positions: Position[];
  totalPortfolioValue: number;
  accountDailyPnL: number;
  cashBalance: number;
  marketValueHistory: number[];
  chartStartTime: number | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  subscribePortfolio: () => () => void;
};

export const useStore = create<AppState>((set, get) => ({
  broker: new IBKRBroker(),
  connectionStatus: "disconnected",
  error: null,
  positions: [],
  totalPortfolioValue: 0,
  accountDailyPnL: 0,
  cashBalance: 0,
  marketValueHistory: [],
  chartStartTime: null,

  connect: async () => {
    const { broker } = get();
    set({ connectionStatus: "connecting", error: null });

    try {
      await broker.connect();

      // Listen for disconnects
      broker.onDisconnect(() => {
        set({
          connectionStatus: "disconnected",
          positions: [],
          totalPortfolioValue: 0,
          accountDailyPnL: 0,
          cashBalance: 0,
          marketValueHistory: [],
          chartStartTime: null,
          error: "Connection lost"
        });
      });

      set({ connectionStatus: "connected" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      set({ connectionStatus: "error", error: message });
    }
  },

  disconnect: async () => {
    const { broker } = get();
    await broker.disconnect();
    set({ connectionStatus: "disconnected", positions: [], totalPortfolioValue: 0, accountDailyPnL: 0, cashBalance: 0, marketValueHistory: [], chartStartTime: null });
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setError: (error) => set({ error }),

  subscribePortfolio: () => {
    const { broker } = get();
    return broker.subscribePortfolio((update) => {
      set((state) => {
        let history = state.marketValueHistory;
        let startTime = state.chartStartTime;
        const newValue = update.totalPortfolioValue;
        const lastValue = history[history.length - 1];

        // Only start recording after initial portfolio load is complete
        if (update.initialLoadComplete && newValue > 0 && newValue !== lastValue) {
          history = [...history, newValue];
          // Set start time on first data point
          if (startTime === null) {
            startTime = Date.now();
          }
          // Keep last 300 values (~5 minutes of data at ~1 update/sec)
          if (history.length > 300) history.shift();
        }

        return {
          positions: update.positions,
          totalPortfolioValue: update.totalPortfolioValue,
          accountDailyPnL: update.accountDailyPnL,
          cashBalance: update.cashBalance,
          marketValueHistory: history,
          chartStartTime: startTime,
        };
      });
    });
  },
}));
