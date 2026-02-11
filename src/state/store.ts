import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/index.js";
import type { Broker, BrokerStatus, Position } from "../broker/types.js";
import { log } from "../utils/logger.js";
import type { ConnectionStatus } from "./types.js";

export type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  error: string | null;
  brokerStatus: BrokerStatus | null;
  positions: Position[];
  positionsMarketValue: number;
  totalEquity: number;
  cashBalance: number;
  cashBalancesByCurrency: Record<string, number>;
  cashExchangeRatesByCurrency: Record<string, number>;
  baseCurrencyCode: string | null;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  subscribePortfolio: () => () => void;
};

const areNumberRecordsEqual = (
  a: Record<string, number>,
  b: Record<string, number>,
): boolean => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }

  return true;
};

const sumCashBalancesByCurrency = (balances: Record<string, number>): number =>
  Object.values(balances).reduce((sum, value) => sum + value, 0);

const formatCashBalancesByCurrency = (balances: Record<string, number>): string => {
  const entries = Object.entries(balances)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => `${currency}:${value.toFixed(2)}`);
  return entries.length > 0 ? entries.join(",") : "none";
};

export const useStore = create<AppState>((set, get) => {
  let unsubscribeDisconnect: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  const cleanupBrokerListeners = (): void => {
    if (unsubscribeDisconnect) {
      unsubscribeDisconnect();
      unsubscribeDisconnect = null;
    }
    if (unsubscribeStatus) {
      unsubscribeStatus();
      unsubscribeStatus = null;
    }
  };

  return {
    broker: new IBKRBroker(),
    connectionStatus: "disconnected",
    error: null,
    brokerStatus: null,
    positions: [],
    positionsMarketValue: 0,
    totalEquity: 0,
    cashBalance: 0,
    cashBalancesByCurrency: {},
    cashExchangeRatesByCurrency: {},
    baseCurrencyCode: null,
    initialLoadComplete: false,
    lastPortfolioUpdateAt: null,

    connect: async () => {
      const { broker } = get();
      set({ connectionStatus: "connecting", error: null, brokerStatus: null });
      cleanupBrokerListeners();

      unsubscribeStatus = broker.onStatus((status) => {
        set({ brokerStatus: status });
      });

      try {
        await broker.connect();

        unsubscribeDisconnect = broker.onDisconnect(() => {
          cleanupBrokerListeners();
          set({
            connectionStatus: "disconnected",
            positions: [],
            positionsMarketValue: 0,
            totalEquity: 0,
            cashBalance: 0,
            cashBalancesByCurrency: {},
            cashExchangeRatesByCurrency: {},
            baseCurrencyCode: null,
            initialLoadComplete: false,
            lastPortfolioUpdateAt: null,
            error: "Connection lost",
            brokerStatus: {
              level: "error",
              message: "Connection lost",
              at: Date.now(),
            },
          });
        });

        set({ connectionStatus: "connected" });
      } catch (err) {
        cleanupBrokerListeners();
        const message = err instanceof Error ? err.message : "Connection failed";
        set({
          connectionStatus: "error",
          error: message,
          brokerStatus: {
            level: "error",
            message,
            at: Date.now(),
          },
        });
      }
    },

    disconnect: async () => {
      const { broker } = get();
      cleanupBrokerListeners();
      await broker.disconnect();
      set({
        connectionStatus: "disconnected",
        positions: [],
        positionsMarketValue: 0,
        totalEquity: 0,
        cashBalance: 0,
        cashBalancesByCurrency: {},
        cashExchangeRatesByCurrency: {},
        baseCurrencyCode: null,
        initialLoadComplete: false,
        lastPortfolioUpdateAt: null,
        error: null,
        brokerStatus: null,
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
          !areNumberRecordsEqual(prev.cashBalancesByCurrency, update.cashBalancesByCurrency) ||
          !areNumberRecordsEqual(prev.cashExchangeRatesByCurrency, update.cashExchangeRatesByCurrency) ||
          prev.baseCurrencyCode !== update.baseCurrencyCode ||
          prev.totalEquity !== update.totalEquity ||
          prev.initialLoadComplete !== update.initialLoadComplete ||
          prev.lastPortfolioUpdateAt !== update.lastPortfolioUpdateAt;

        set({
          positions: update.positions,
          positionsMarketValue: update.positionsMarketValue,
          totalEquity: update.totalEquity,
          cashBalance: update.cashBalance,
          cashBalancesByCurrency: update.cashBalancesByCurrency,
          cashExchangeRatesByCurrency: update.cashExchangeRatesByCurrency,
          baseCurrencyCode: update.baseCurrencyCode,
          initialLoadComplete: update.initialLoadComplete,
          lastPortfolioUpdateAt: update.lastPortfolioUpdateAt,
        });

        if (snapshotChanged) {
          const cashFx = sumCashBalancesByCurrency(update.cashBalancesByCurrency);
          log(
            "debug",
            "state.snapshot",
            `positionsMV=${update.positionsMarketValue.toFixed(2)} cash=${update.cashBalance.toFixed(2)} cashFx=${cashFx.toFixed(2)} cashFxRows=${formatCashBalancesByCurrency(update.cashBalancesByCurrency)} totalEquity=${update.totalEquity.toFixed(2)}`
          );
        }
      });
    },
  };
});
