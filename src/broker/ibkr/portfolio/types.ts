import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";

export type PortfolioContract = {
  conId?: number;
  symbol?: string;
  currency?: string;
};

export type PortfolioContractSeed = {
  conId?: number;
  symbol?: string;
  currency?: string;
  exchange?: string;
  secType?: string;
};

export type ContractDetailsPayload = {
  contract?: { conId?: number };
  timeZoneId?: string;
  liquidHours?: string;
  tradingHours?: string;
};

export type PortfolioEventMap = {
  updatePortfolio: [
    contract: PortfolioContractSeed,
    pos: number,
    marketPrice: number,
    marketValue: number,
    avgCost?: number,
    unrealizedPnL?: number,
    realizedPnL?: number,
    accountName?: string,
  ];
  updateAccountValue: [key: string, value: string, currency: string, accountName: string];
  accountDownloadEnd: [accountName: string];
  contractDetails: [reqId: number, details: ContractDetailsPayload];
  contractDetailsEnd: [reqId: number];
};

export type PortfolioApi = {
  on<E extends keyof PortfolioEventMap>(
    event: E,
    handler: (...args: PortfolioEventMap[E]) => void,
  ): void;
  removeListener<E extends keyof PortfolioEventMap>(
    event: E,
    handler: (...args: PortfolioEventMap[E]) => void,
  ): void;
  reqAccountUpdates(subscribe: boolean, accountId: string): void;
  reqContractDetails(reqId: number, contract: PortfolioContractSeed): void;
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
