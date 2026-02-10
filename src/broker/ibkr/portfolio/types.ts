import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";

export type PortfolioContract = {
  conId?: number;
  symbol?: string;
  currency?: string;
};

export type PortfolioUpdateEvent = {
  contract: PortfolioContract;
  pos: number;
  marketPrice: number;
  marketValue: number;
  avgCost?: number;
  unrealizedPnL?: number;
  realizedPnL?: number;
};

export type PortfolioProjection = {
  applyPortfolioUpdate(event: PortfolioUpdateEvent): void;
  applyCashBalance(value: string): void;
  markInitialLoadComplete(): void;
  attachMarketHours(conId: number, marketHours: PositionMarketHours): void;
  snapshot(): PortfolioUpdate;
};

export type PortfolioState = {
  positions: Map<number, Position>;
  positionsMarketValue: number;
  cashBalance: number;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number;
};
