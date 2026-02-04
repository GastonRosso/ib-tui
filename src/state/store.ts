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
    set({ connectionStatus: "disconnected", positions: [], totalPortfolioValue: 0, accountDailyPnL: 0, cashBalance: 0, marketValueHistory: [] });
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setError: (error) => set({ error }),

  subscribePortfolio: () => {
    const { broker } = get();
    return broker.subscribePortfolio((update) => {
      set((state) => {
        const history = [...state.marketValueHistory, update.totalPortfolioValue];
        // Keep last 300 values (~5 minutes of data at ~1 update/sec)
        if (history.length > 300) history.shift();
        return {
          positions: update.positions,
          totalPortfolioValue: update.totalPortfolioValue,
          accountDailyPnL: update.accountDailyPnL,
          cashBalance: update.cashBalance,
          marketValueHistory: history,
        };
      });
    });
  },
}));
