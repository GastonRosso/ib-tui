import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/IBKRBroker.js";
import type { Broker, Position } from "../broker/types.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  error: string | null;
  positions: Position[];
  positionsMarketValue: number;
  totalEquity: number;
  accountDailyPnL: number;
  cashBalance: number;
  positionPnlReady: boolean;
  accountPnlReady: boolean;
  marketValueHistory: number[];
  chartStartTime: number | null;
  lastHistoryTimestamp: number | null;
  chartStartValue: number | null;
  initialLoadComplete: boolean;

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
  accountDailyPnL: 0,
  cashBalance: 0,
  positionPnlReady: false,
  accountPnlReady: false,
  marketValueHistory: [],
  chartStartTime: null,
  lastHistoryTimestamp: null,
  chartStartValue: null,
  initialLoadComplete: false,

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
          accountDailyPnL: 0,
          cashBalance: 0,
          positionPnlReady: false,
          accountPnlReady: false,
          marketValueHistory: [],
          chartStartTime: null,
          lastHistoryTimestamp: null,
          chartStartValue: null,
          initialLoadComplete: false,
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
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setError: (error) => set({ error }),

  subscribePortfolio: () => {
    const { broker } = get();
    return broker.subscribePortfolio((update) => {
      set((state) => {
        // throttle to roughly once per second and avoid oversampling the feed
        const historyLimit = 300;
        const sampleIntervalMs = 1000;

        let history = state.marketValueHistory;
        let startTime = state.chartStartTime;
        let lastHistoryTimestamp = state.lastHistoryTimestamp;
        let chartStartValue = state.chartStartValue;

        const newValue = update.totalEquity;
        const now = Date.now();
        const lastValue = history[history.length - 1];

        const intervalElapsed =
          lastHistoryTimestamp === null || now - lastHistoryTimestamp >= sampleIntervalMs;

        if (update.initialLoadComplete && newValue > 0) {
          // if we get multiple updates within the same second, keep only the freshest value
          if (!intervalElapsed && history.length > 0) {
            history = [...history.slice(0, -1), newValue];
          } else if (intervalElapsed || newValue !== lastValue) {
            history = [...history, newValue];
            lastHistoryTimestamp = now;

            // Set start time on first data point
            if (startTime === null) {
              startTime = now;
              chartStartValue = newValue;
            }

            // Keep last 300 values (~5 minutes of data at ~1 update/sec)
            if (history.length > historyLimit) {
              const excess = history.length - historyLimit;
              history = history.slice(-historyLimit);
              if (startTime !== null) {
                startTime += excess * sampleIntervalMs;
              }
              // Keep chartStartValue as original baseline
            }
          }
        }

        return {
          positions: update.positions,
          positionsMarketValue: update.positionsMarketValue,
          totalEquity: update.totalEquity,
          accountDailyPnL: update.accountDailyPnL,
          cashBalance: update.cashBalance,
          positionPnlReady: update.positionPnlReady,
          accountPnlReady: update.accountPnlReady,
          marketValueHistory: history,
          chartStartTime: startTime,
          lastHistoryTimestamp,
          chartStartValue,
          initialLoadComplete: update.initialLoadComplete,
        };
      });
    });
  },
}));
