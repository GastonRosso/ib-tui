import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";
import type { PortfolioProjection, PortfolioState, PortfolioUpdateEvent } from "./types.js";

const recomputeMarketValue = (positions: Map<number, Position>): number =>
  Array.from(positions.values()).reduce((sum, p) => sum + p.marketValue, 0);

export const createPortfolioProjection = (now = () => Date.now()): PortfolioProjection => {
  const state: PortfolioState = {
    positions: new Map<number, Position>(),
    positionsMarketValue: 0,
    cashBalance: 0,
    initialLoadComplete: false,
    lastPortfolioUpdateAt: now(),
  };

  const snapshot = (): PortfolioUpdate => ({
    positions: Array.from(state.positions.values()),
    positionsMarketValue: state.positionsMarketValue,
    cashBalance: state.cashBalance,
    totalEquity: state.positionsMarketValue + state.cashBalance,
    initialLoadComplete: state.initialLoadComplete,
    lastPortfolioUpdateAt: state.lastPortfolioUpdateAt,
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
      });
    }
    state.positionsMarketValue = recomputeMarketValue(state.positions);
    state.lastPortfolioUpdateAt = now();
  };

  const applyCashBalance = (value: string): void => {
    state.cashBalance = Number.parseFloat(value) || 0;
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

  return { applyPortfolioUpdate, applyCashBalance, markInitialLoadComplete, attachMarketHours, snapshot };
};
