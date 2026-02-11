import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/index.js";
import type { Broker, BrokerStatus, Position, PortfolioUpdate } from "../broker/types.js";
import { log } from "../utils/logger.js";
import type { ConnectionStatus } from "./types.js";

export type DisplayCurrencyPreference = "BASE" | string;

export type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  error: string | null;
  brokerStatus: BrokerStatus | null;
  positions: Position[];
  positionsMarketValue: number;
  positionsUnrealizedPnL: number;
  totalEquity: number;
  cashBalance: number;
  cashBalancesByCurrency: Record<string, number>;
  cashExchangeRatesByCurrency: Record<string, number>;
  baseCurrencyCode: string | null;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number | null;
  positionsPendingFxCount: number;
  positionsPendingFxByCurrency: Record<string, number>;

  displayCurrencyPreference: DisplayCurrencyPreference;
  displayCurrencyCode: string | null;
  displayFxRate: number;
  availableDisplayCurrencies: string[];
  displayCurrencyWarning: string | null;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  subscribePortfolio: () => () => void;
  setDisplayCurrencyPreference: (preference: DisplayCurrencyPreference) => void;
  cycleDisplayCurrency: (direction: "next" | "prev") => void;
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

const deriveAvailableDisplayCurrencies = (update: PortfolioUpdate): string[] => {
  const currencies = new Set<string>();
  if (update.baseCurrencyCode) currencies.add(update.baseCurrencyCode);
  for (const position of update.positions) {
    currencies.add(position.currency);
  }
  for (const currency of Object.keys(update.cashBalancesByCurrency)) {
    currencies.add(currency);
  }
  return Array.from(currencies).sort();
};

const resolveDisplayCurrency = (
  preference: DisplayCurrencyPreference,
  baseCurrencyCode: string | null,
  available: string[],
  exchangeRates: Record<string, number>,
): { code: string | null; warning: string | null; displayFxRate: number } => {
  if (!baseCurrencyCode) return { code: null, warning: null, displayFxRate: 1 };

  if (preference === "BASE" || preference === baseCurrencyCode) {
    return { code: baseCurrencyCode, warning: null, displayFxRate: 1 };
  }

  const fxRate = exchangeRates[preference];
  if (available.includes(preference) && fxRate !== undefined) {
    // displayFxRate converts from base→display: divide base values by this FX rate.
    // exchangeRates maps currency→base (e.g. EUR→USD = 1.1), so base→EUR = 1/1.1.
    return { code: preference, warning: null, displayFxRate: 1 / fxRate };
  }

  return {
    code: baseCurrencyCode,
    warning: `Display currency ${preference} is not available, showing ${baseCurrencyCode}`,
    displayFxRate: 1,
  };
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
            error: "Connection lost",
            brokerStatus: {
              level: "error",
              message: "Connection lost",
              at: Date.now(),
            },
            displayCurrencyCode: null,
            displayFxRate: 1,
            availableDisplayCurrencies: [],
            displayCurrencyWarning: null,
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
        error: null,
        brokerStatus: null,
        displayCurrencyCode: null,
        displayFxRate: 1,
        availableDisplayCurrencies: [],
        displayCurrencyWarning: null,
      });
    },

    setConnectionStatus: (status) => set({ connectionStatus: status }),
    setError: (error) => set({ error }),

    setDisplayCurrencyPreference: (preference) => {
      const { baseCurrencyCode, availableDisplayCurrencies, cashExchangeRatesByCurrency } = get();
      const { code, warning, displayFxRate } = resolveDisplayCurrency(preference, baseCurrencyCode, availableDisplayCurrencies, cashExchangeRatesByCurrency);
      set({
        displayCurrencyPreference: preference,
        displayCurrencyCode: code,
        displayFxRate,
        displayCurrencyWarning: warning,
      });
    },

    cycleDisplayCurrency: (direction) => {
      const { availableDisplayCurrencies, displayCurrencyPreference, baseCurrencyCode, cashExchangeRatesByCurrency } = get();
      if (availableDisplayCurrencies.length === 0) return;

      // Use the preference (not the resolved code) as cursor to avoid getting
      // stuck when the current preference resolves to base via fallback.
      const cursorCurrency = displayCurrencyPreference === "BASE" ? baseCurrencyCode : displayCurrencyPreference;
      const currentIndex = cursorCurrency
        ? availableDisplayCurrencies.indexOf(cursorCurrency)
        : -1;

      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (direction === "next") {
        nextIndex = (currentIndex + 1) % availableDisplayCurrencies.length;
      } else {
        nextIndex = (currentIndex - 1 + availableDisplayCurrencies.length) % availableDisplayCurrencies.length;
      }

      const nextCurrency = availableDisplayCurrencies[nextIndex];
      const preference = nextCurrency === baseCurrencyCode ? "BASE" : nextCurrency;
      const { code, warning, displayFxRate } = resolveDisplayCurrency(preference, baseCurrencyCode, availableDisplayCurrencies, cashExchangeRatesByCurrency);
      set({
        displayCurrencyPreference: preference,
        displayCurrencyCode: code,
        displayFxRate,
        displayCurrencyWarning: warning,
      });
    },

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

        const available = deriveAvailableDisplayCurrencies(update);
        const { code, warning, displayFxRate } = resolveDisplayCurrency(
          prev.displayCurrencyPreference,
          update.baseCurrencyCode,
          available,
          update.cashExchangeRatesByCurrency,
        );

        set({
          positions: update.positions,
          positionsMarketValue: update.positionsMarketValue,
          positionsUnrealizedPnL: update.positionsUnrealizedPnL,
          totalEquity: update.totalEquity,
          cashBalance: update.cashBalance,
          cashBalancesByCurrency: update.cashBalancesByCurrency,
          cashExchangeRatesByCurrency: update.cashExchangeRatesByCurrency,
          baseCurrencyCode: update.baseCurrencyCode,
          initialLoadComplete: update.initialLoadComplete,
          lastPortfolioUpdateAt: update.lastPortfolioUpdateAt,
          positionsPendingFxCount: update.positionsPendingFxCount,
          positionsPendingFxByCurrency: update.positionsPendingFxByCurrency,
          availableDisplayCurrencies: available,
          displayCurrencyCode: code,
          displayFxRate,
          displayCurrencyWarning: warning,
        });

        if (snapshotChanged) {
          const cashFx = sumCashBalancesByCurrency(update.cashBalancesByCurrency);
          log(
            "debug",
            "state.snapshot",
            `positionsMV=${update.positionsMarketValue.toFixed(2)} cash=${update.cashBalance.toFixed(2)} cashFx=${cashFx.toFixed(2)} cashFxRows=${formatCashBalancesByCurrency(update.cashBalancesByCurrency)} totalEquity=${update.totalEquity.toFixed(2)} baseCcy=${update.baseCurrencyCode ?? "n/a"} displayCcy=${code ?? "n/a"} pendingFx=${update.positionsPendingFxCount}`
          );
        }
      });
    },
  };
});
