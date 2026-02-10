import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/index.js";
import type { Broker, Position } from "../broker/types.js";
import { log } from "../utils/logger.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  error: string | null;
  positions: Position[];
  positionsMarketValue: number;
  totalEquity: number;
  cashBalance: number;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number | null;

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
  positionsMarketValue: 0,
  totalEquity: 0,
  cashBalance: 0,
  initialLoadComplete: false,
  lastPortfolioUpdateAt: null,

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
          positionsMarketValue: 0,
          totalEquity: 0,
          cashBalance: 0,
          initialLoadComplete: false,
          lastPortfolioUpdateAt: null,
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
    set({
      connectionStatus: "disconnected",
      positions: [],
      positionsMarketValue: 0,
      totalEquity: 0,
      cashBalance: 0,
      initialLoadComplete: false,
      lastPortfolioUpdateAt: null,
    });
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setError: (error) => set({ error }),

  subscribePortfolio: () => {
    const { broker } = get();
    return broker.subscribePortfolio((update) => {
      const prev = get();
      const snapshotChanged =
        prev.positionsMarketValue !== update.positionsMarketValue ||
        prev.cashBalance !== update.cashBalance ||
        prev.totalEquity !== update.totalEquity ||
        prev.initialLoadComplete !== update.initialLoadComplete ||
        prev.lastPortfolioUpdateAt !== update.lastPortfolioUpdateAt;

      set({
        positions: update.positions,
        positionsMarketValue: update.positionsMarketValue,
        totalEquity: update.totalEquity,
        cashBalance: update.cashBalance,
        initialLoadComplete: update.initialLoadComplete,
        lastPortfolioUpdateAt: update.lastPortfolioUpdateAt,
      });

      if (snapshotChanged) {
        log(
          "debug",
          "state.snapshot",
          `positionsMV=${update.positionsMarketValue.toFixed(2)} cash=${update.cashBalance.toFixed(2)} totalEquity=${update.totalEquity.toFixed(2)}`
        );
      }
    });
  },
}));
