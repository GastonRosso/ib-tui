import { create } from "zustand";
import { IBKRBroker } from "../broker/ibkr/index.js";
import type {
  Broker,
  BrokerStatus,
  BrokerStatusLevel,
  Position,
  PortfolioUpdate,
} from "../broker/types.js";
import { log } from "../utils/logger.js";
import type { ConnectionHealth, ConnectionStatus } from "./types.js";

export type DisplayCurrencyPreference = "BASE" | string;

export type StatusEvent = {
  at: number;
  level: BrokerStatusLevel;
  message: string;
  code?: number;
  reqId?: number;
  repeatCount: number;
};

export type AppState = {
  broker: Broker;
  connectionStatus: ConnectionStatus;
  connectionHealth: ConnectionHealth;
  error: string | null;
  brokerStatus: BrokerStatus | null;
  retryAttempt: number;
  nextRetryAt: number | null;
  statusHistory: StatusEvent[];
  statusHistoryIndex: number;

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
  startAutoConnect: () => void;
  stopAutoConnect: () => void;
  selectOlderStatus: () => void;
  selectNewerStatus: () => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  subscribePortfolio: () => () => void;
  setDisplayCurrencyPreference: (preference: DisplayCurrencyPreference) => void;
  cycleDisplayCurrency: (direction: "next" | "prev") => void;
};

const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 30_000;
const STATUS_HISTORY_LIMIT = 1_000;
const STATUS_DEDUPE_WINDOW_MS = 10_000;

const RECOVERY_CODES = new Set([1101, 1102, 2104, 2106, 2158]);
const NON_DEGRADING_WARN_CODES = new Set([2107, 2108]);
const SIGNIFICANT_INFO_CODES = new Set([
  1100,
  1101,
  1102,
  1300,
  2103,
  2104,
  2105,
  2106,
  2107,
  2108,
  2110,
  2157,
  2158,
]);

const normalizeStatusMessage = (message: string): string =>
  message.replace(/\s+/g, " ").trim();

const isLifecycleMessage = (message: string): boolean => {
  const normalized = normalizeStatusMessage(message).toLowerCase();
  return (
    normalized === "connected to ibkr" ||
    normalized === "disconnected from ibkr" ||
    normalized === "connection lost" ||
    normalized === "connection timeout" ||
    normalized === "connection failed"
  );
};

const isSignificantStatus = (status: BrokerStatus): boolean => {
  if (status.level === "warn" || status.level === "error") return true;
  if (status.code !== undefined && SIGNIFICANT_INFO_CODES.has(status.code)) return true;
  return isLifecycleMessage(status.message);
};

const createStatusEvent = (status: BrokerStatus): StatusEvent => ({
  at: status.at,
  level: status.level,
  message: normalizeStatusMessage(status.message),
  code: status.code,
  reqId: status.reqId,
  repeatCount: 1,
});

const areEventsEquivalent = (a: StatusEvent, b: StatusEvent): boolean =>
  a.level === b.level &&
  a.message === b.message &&
  a.code === b.code &&
  a.reqId === b.reqId;

const appendStatusEvent = (
  history: StatusEvent[],
  index: number,
  next: StatusEvent,
): { history: StatusEvent[]; index: number } => {
  const latestIndex = history.length - 1;
  const atLatest = history.length === 0 || index >= latestIndex;

  if (latestIndex >= 0) {
    const latest = history[latestIndex];
    const withinWindow = next.at - latest.at <= STATUS_DEDUPE_WINDOW_MS;

    if (withinWindow && areEventsEquivalent(latest, next)) {
      const merged = {
        ...latest,
        at: next.at,
        repeatCount: latest.repeatCount + 1,
      };
      const mergedHistory = [...history.slice(0, latestIndex), merged];
      return {
        history: mergedHistory,
        index: atLatest ? mergedHistory.length - 1 : Math.max(0, index),
      };
    }
  }

  const appended = [...history, next];
  const overflow = Math.max(0, appended.length - STATUS_HISTORY_LIMIT);
  const trimmed = overflow > 0 ? appended.slice(overflow) : appended;

  if (atLatest) {
    return {
      history: trimmed,
      index: trimmed.length - 1,
    };
  }

  return {
    history: trimmed,
    index: Math.min(trimmed.length - 1, Math.max(0, index - overflow)),
  };
};

const getRetryDelayMs = (attempt: number): number => {
  const normalizedAttempt = Math.max(1, attempt);
  return Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** (normalizedAttempt - 1),
  );
};

const resolveHealthFromStatus = (
  connectionStatus: ConnectionStatus,
  currentHealth: ConnectionHealth,
  status: BrokerStatus,
): ConnectionHealth => {
  if (connectionStatus !== "connected") return "down";
  if (status.code !== undefined && NON_DEGRADING_WARN_CODES.has(status.code)) {
    return currentHealth;
  }
  if (status.level === "warn" || status.level === "error") return "degraded";
  if (status.code !== undefined && RECOVERY_CODES.has(status.code)) return "healthy";
  if (normalizeStatusMessage(status.message).toLowerCase() === "connected to ibkr") {
    return "healthy";
  }
  return currentHealth;
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

const getDisconnectedPortfolioReset = () => ({
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
  displayCurrencyCode: null,
  displayFxRate: 1,
  availableDisplayCurrencies: [],
  displayCurrencyWarning: null,
});

export const useStore = create<AppState>((set, get) => {
  let unsubscribeDisconnect: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let connectInFlight: Promise<void> | null = null;
  let autoConnectEnabled = false;

  const clearRetryTimer = (): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

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

  const recordStatus = (status: BrokerStatus): void => {
    if (!isSignificantStatus(status)) return;
    const event = createStatusEvent(status);

    set((state) => {
      const appended = appendStatusEvent(
        state.statusHistory,
        state.statusHistoryIndex,
        event,
      );
      return {
        statusHistory: appended.history,
        statusHistoryIndex: appended.index,
      };
    });
  };

  const scheduleReconnect = (attempt: number): void => {
    if (!autoConnectEnabled) return;

    clearRetryTimer();
    const delayMs = getRetryDelayMs(attempt);
    const nextRetryAt = Date.now() + delayMs;

    set({
      retryAttempt: attempt,
      nextRetryAt,
    });

    retryTimer = setTimeout(() => {
      retryTimer = null;
      set({ nextRetryAt: null });
      void get().connect();
    }, delayMs);
  };

  return {
    broker: new IBKRBroker(),
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

    connect: async () => {
      if (connectInFlight) return connectInFlight;

      const { broker } = get();
      clearRetryTimer();

      set({
        connectionStatus: "connecting",
        connectionHealth: "down",
        error: null,
        nextRetryAt: null,
      });
      cleanupBrokerListeners();

      unsubscribeStatus = broker.onStatus((incomingStatus) => {
        const status: BrokerStatus = {
          ...incomingStatus,
          message: normalizeStatusMessage(incomingStatus.message),
        };

        recordStatus(status);
        set((state) => ({
          brokerStatus: status,
          connectionHealth: resolveHealthFromStatus(
            state.connectionStatus,
            state.connectionHealth,
            status,
          ),
        }));
      });

      connectInFlight = (async () => {
        try {
          await broker.connect();

          unsubscribeDisconnect = broker.onDisconnect(() => {
            cleanupBrokerListeners();

            const status: BrokerStatus = {
              level: "error",
              message: "Connection lost",
              at: Date.now(),
            };

            recordStatus(status);
            set({
              connectionStatus: "disconnected",
              connectionHealth: "down",
              error: status.message,
              brokerStatus: status,
            });

            if (autoConnectEnabled) {
              scheduleReconnect(get().retryAttempt + 1);
            }
          });

          set({
            connectionStatus: "connected",
            connectionHealth: "healthy",
            error: null,
            retryAttempt: 0,
            nextRetryAt: null,
          });
        } catch (err) {
          cleanupBrokerListeners();
          const message = err instanceof Error ? err.message : "Connection failed";
          const status: BrokerStatus = {
            level: "error",
            message: normalizeStatusMessage(message),
            at: Date.now(),
          };

          recordStatus(status);
          set({
            connectionStatus: "error",
            connectionHealth: "down",
            error: status.message,
            brokerStatus: status,
          });

          if (autoConnectEnabled) {
            scheduleReconnect(get().retryAttempt + 1);
          }
        } finally {
          connectInFlight = null;
        }
      })();

      return connectInFlight;
    },

    disconnect: async () => {
      const { broker } = get();
      clearRetryTimer();
      cleanupBrokerListeners();
      await broker.disconnect();
      set({
        connectionStatus: "disconnected",
        connectionHealth: "down",
        retryAttempt: 0,
        nextRetryAt: null,
        error: null,
        brokerStatus: null,
        ...getDisconnectedPortfolioReset(),
      });
    },

    startAutoConnect: () => {
      autoConnectEnabled = true;
      clearRetryTimer();
      set({ retryAttempt: 0, nextRetryAt: null });

      const { connectionStatus } = get();
      if (connectionStatus === "disconnected" || connectionStatus === "error") {
        void get().connect();
      }
    },

    stopAutoConnect: () => {
      autoConnectEnabled = false;
      clearRetryTimer();
      set({ retryAttempt: 0, nextRetryAt: null });
    },

    selectOlderStatus: () => {
      set((state) => {
        if (state.statusHistory.length === 0) {
          return state;
        }
        return {
          statusHistoryIndex: Math.max(0, state.statusHistoryIndex - 1),
        };
      });
    },

    selectNewerStatus: () => {
      set((state) => {
        if (state.statusHistory.length === 0) {
          return state;
        }
        return {
          statusHistoryIndex: Math.min(
            state.statusHistory.length - 1,
            state.statusHistoryIndex + 1,
          ),
        };
      });
    },

    setConnectionStatus: (status) =>
      set((state) => ({
        connectionStatus: status,
        connectionHealth: status === "connected" ? state.connectionHealth : "down",
      })),

    setError: (error) => set({ error }),

    setDisplayCurrencyPreference: (preference) => {
      const {
        baseCurrencyCode,
        availableDisplayCurrencies,
        cashExchangeRatesByCurrency,
      } = get();
      const { code, warning, displayFxRate } = resolveDisplayCurrency(
        preference,
        baseCurrencyCode,
        availableDisplayCurrencies,
        cashExchangeRatesByCurrency,
      );
      set({
        displayCurrencyPreference: preference,
        displayCurrencyCode: code,
        displayFxRate,
        displayCurrencyWarning: warning,
      });
    },

    cycleDisplayCurrency: (direction) => {
      const {
        availableDisplayCurrencies,
        displayCurrencyPreference,
        baseCurrencyCode,
        cashExchangeRatesByCurrency,
      } = get();
      if (availableDisplayCurrencies.length === 0) return;

      // Use the preference (not the resolved code) as cursor to avoid getting
      // stuck when the current preference resolves to base via fallback.
      const cursorCurrency =
        displayCurrencyPreference === "BASE"
          ? baseCurrencyCode
          : displayCurrencyPreference;
      const currentIndex = cursorCurrency
        ? availableDisplayCurrencies.indexOf(cursorCurrency)
        : -1;

      let nextIndex: number;
      if (currentIndex === -1) {
        nextIndex = 0;
      } else if (direction === "next") {
        nextIndex = (currentIndex + 1) % availableDisplayCurrencies.length;
      } else {
        nextIndex =
          (currentIndex - 1 + availableDisplayCurrencies.length) %
          availableDisplayCurrencies.length;
      }

      const nextCurrency = availableDisplayCurrencies[nextIndex];
      const preference = nextCurrency === baseCurrencyCode ? "BASE" : nextCurrency;
      const { code, warning, displayFxRate } = resolveDisplayCurrency(
        preference,
        baseCurrencyCode,
        availableDisplayCurrencies,
        cashExchangeRatesByCurrency,
      );
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
          !areNumberRecordsEqual(
            prev.cashBalancesByCurrency,
            update.cashBalancesByCurrency,
          ) ||
          !areNumberRecordsEqual(
            prev.cashExchangeRatesByCurrency,
            update.cashExchangeRatesByCurrency,
          ) ||
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
            `positionsMV=${update.positionsMarketValue.toFixed(2)} cash=${update.cashBalance.toFixed(2)} cashFx=${cashFx.toFixed(2)} cashFxRows=${formatCashBalancesByCurrency(update.cashBalancesByCurrency)} totalEquity=${update.totalEquity.toFixed(2)} baseCcy=${update.baseCurrencyCode ?? "n/a"} displayCcy=${code ?? "n/a"} pendingFx=${update.positionsPendingFxCount}`,
          );
        }
      });
    },
  };
});
