import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";
import type { PortfolioProjection, PortfolioState, PortfolioUpdateEvent } from "./types.js";

const toCashBalancesByCurrency = (balances: Map<string, number>): Record<string, number> =>
  Array.from(balances.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Record<string, number>>((acc, [currency, value]) => {
      acc[currency] = value;
      return acc;
    }, {});

const toExchangeRatesByCurrency = (rates: Map<string, number>): Record<string, number> =>
  Array.from(rates.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce<Record<string, number>>((acc, [currency, value]) => {
      acc[currency] = value;
      return acc;
    }, {});

const recomputeCashBalancesInBase = (state: PortfolioState): void => {
  state.cashBalancesByCurrency.clear();

  const baseCurrencyCode = state.baseCurrencyCode;
  const hasBaseCashBalance = state.hasBaseCashBalance;
  const rawByCurrency = new Map<string, number>();
  let rawNonBaseTotal = 0;
  let baseCurrencyLocalAmount = 0;

  for (const [currency, localAmount] of state.localCashBalancesByCurrency.entries()) {
    if (baseCurrencyCode && currency === baseCurrencyCode) {
      baseCurrencyLocalAmount = localAmount;
      rawByCurrency.set(currency, localAmount);
      continue;
    }

    const exchangeRate = state.exchangeRatesByCurrency.get(currency);
    if (exchangeRate === undefined) continue;

    const rawValueInBase = localAmount * exchangeRate;
    rawByCurrency.set(currency, rawValueInBase);
    rawNonBaseTotal += rawValueInBase;
  }

  let nonBaseScale = 1;
  if (hasBaseCashBalance && baseCurrencyCode && rawNonBaseTotal > 0) {
    const targetNonBaseInBase = Math.max(0, state.cashBalance - baseCurrencyLocalAmount);
    nonBaseScale = targetNonBaseInBase / rawNonBaseTotal;
  }

  for (const [currency, rawValueInBase] of rawByCurrency.entries()) {
    if (baseCurrencyCode && currency !== baseCurrencyCode) {
      state.cashBalancesByCurrency.set(currency, rawValueInBase * nonBaseScale);
      continue;
    }

    state.cashBalancesByCurrency.set(currency, rawValueInBase);
  }
};

const recomputePositionBaseValues = (state: PortfolioState): void => {
  let positionsMarketValue = 0;
  let positionsUnrealizedPnL = 0;
  let pendingFxCount = 0;
  const pendingFxByCurrency = new Map<string, number>();

  for (const [conId, position] of state.positions.entries()) {
    const currency = position.currency;
    let fxRate: number | null;
    let isFxPending: boolean;

    if (!state.baseCurrencyCode || currency === state.baseCurrencyCode) {
      fxRate = 1;
      isFxPending = false;
    } else {
      const rate = state.exchangeRatesByCurrency.get(currency);
      if (rate !== undefined) {
        fxRate = rate;
        isFxPending = false;
      } else {
        fxRate = null;
        isFxPending = true;
      }
    }

    const marketValueBase = fxRate !== null ? position.marketValue * fxRate : null;
    const unrealizedPnLBase = fxRate !== null ? position.unrealizedPnL * fxRate : null;

    state.positions.set(conId, {
      ...position,
      marketValueBase,
      unrealizedPnLBase,
      fxRateToBase: fxRate,
      isFxPending,
    });

    if (marketValueBase !== null) {
      positionsMarketValue += marketValueBase;
    } else {
      pendingFxCount++;
      const existing = pendingFxByCurrency.get(currency) ?? 0;
      pendingFxByCurrency.set(currency, existing + position.marketValue);
    }

    if (unrealizedPnLBase !== null) {
      positionsUnrealizedPnL += unrealizedPnLBase;
    }
  }

  state.positionsMarketValue = positionsMarketValue;
  state.positionsUnrealizedPnL = positionsUnrealizedPnL;
  state.positionsPendingFxCount = pendingFxCount;
  state.positionsPendingFxByCurrency = pendingFxByCurrency;
};

export const createPortfolioProjection = (now = () => Date.now()): PortfolioProjection => {
  const state: PortfolioState = {
    positions: new Map<number, Position>(),
    positionsMarketValue: 0,
    positionsUnrealizedPnL: 0,
    cashBalance: 0,
    cashBalancesByCurrency: new Map<string, number>(),
    localCashBalancesByCurrency: new Map<string, number>(),
    exchangeRatesByCurrency: new Map<string, number>(),
    baseCurrencyCode: null,
    hasBaseCashBalance: false,
    initialLoadComplete: false,
    lastPortfolioUpdateAt: now(),
    positionsPendingFxCount: 0,
    positionsPendingFxByCurrency: new Map<string, number>(),
  };

  const toPendingFxByCurrency = (pending: Map<string, number>): Record<string, number> =>
    Array.from(pending.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Record<string, number>>((acc, [currency, value]) => {
        acc[currency] = value;
        return acc;
      }, {});

  const snapshot = (): PortfolioUpdate => ({
    positions: Array.from(state.positions.values()),
    positionsMarketValue: state.positionsMarketValue,
    positionsUnrealizedPnL: state.positionsUnrealizedPnL,
    cashBalance: state.cashBalance,
    cashBalancesByCurrency: toCashBalancesByCurrency(state.cashBalancesByCurrency),
    cashExchangeRatesByCurrency: toExchangeRatesByCurrency(state.exchangeRatesByCurrency),
    baseCurrencyCode: state.baseCurrencyCode,
    totalEquity: state.positionsMarketValue + state.cashBalance,
    initialLoadComplete: state.initialLoadComplete,
    lastPortfolioUpdateAt: state.lastPortfolioUpdateAt,
    positionsPendingFxCount: state.positionsPendingFxCount,
    positionsPendingFxByCurrency: toPendingFxByCurrency(state.positionsPendingFxByCurrency),
  });

  const applyPortfolioUpdate = (event: PortfolioUpdateEvent): void => {
    const conId = event.contract.conId;
    if (conId === undefined || conId === null) return;
    const existing = state.positions.get(conId);
    if (event.pos === 0) {
      state.positions.delete(conId);
    } else {
      state.positions.set(conId, {
        symbol: event.contract.symbol ?? "",
        quantity: event.pos,
        avgCost: event.avgCost ?? 0,
        marketValue: event.marketValue,
        unrealizedPnL: event.unrealizedPnL ?? existing?.unrealizedPnL ?? 0,
        dailyPnL: 0,
        realizedPnL: event.realizedPnL ?? existing?.realizedPnL ?? 0,
        marketPrice: event.marketPrice,
        currency: event.contract.currency ?? "USD",
        conId,
        marketHours: existing?.marketHours,
        marketValueBase: null,
        unrealizedPnLBase: null,
        fxRateToBase: null,
        isFxPending: false,
      });
    }
    recomputePositionBaseValues(state);
    state.lastPortfolioUpdateAt = now();
  };

  const applyCashBalance = (currency: string, value: string): void => {
    const parsed = Number.parseFloat(value);
    const nextValue = Number.isFinite(parsed) ? parsed : 0;

    if (currency === "BASE") {
      state.cashBalance = nextValue;
      state.hasBaseCashBalance = true;
      recomputeCashBalancesInBase(state);
    } else if (currency) {
      state.localCashBalancesByCurrency.set(currency, nextValue);
      recomputeCashBalancesInBase(state);
    }

    state.lastPortfolioUpdateAt = now();
  };

  const applyExchangeRate = (currency: string, value: string): void => {
    const parsed = Number.parseFloat(value);
    if (!currency || !Number.isFinite(parsed)) return;
    state.exchangeRatesByCurrency.set(currency, parsed);
    recomputeCashBalancesInBase(state);
    recomputePositionBaseValues(state);
    state.lastPortfolioUpdateAt = now();
  };

  const setBaseCurrency = (currency: string): void => {
    if (!currency || currency === "BASE") return;
    if (state.baseCurrencyCode === currency) return;
    state.baseCurrencyCode = currency;
    recomputeCashBalancesInBase(state);
    recomputePositionBaseValues(state);
    state.lastPortfolioUpdateAt = now();
  };

  const markInitialLoadComplete = (): void => {
    state.initialLoadComplete = true;
    state.lastPortfolioUpdateAt = now();
  };

  const attachMarketHours = (conId: number, marketHours: PositionMarketHours): void => {
    const existing = state.positions.get(conId);
    if (!existing) return;
    state.positions.set(conId, { ...existing, marketHours });
    state.lastPortfolioUpdateAt = now();
  };

  return { applyPortfolioUpdate, applyCashBalance, applyExchangeRate, setBaseCurrency, markInitialLoadComplete, attachMarketHours, snapshot };
};
