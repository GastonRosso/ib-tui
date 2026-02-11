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
  updateAccountTime: [timestamp: string];
  accountDownloadEnd: [accountName: string];
  contractDetails: [reqId: number, details: ContractDetailsPayload];
  contractDetailsEnd: [reqId: number];
  tickPrice: [reqId: number, tickType: number, price: number, canAutoExecute: boolean];
  tickSize: [reqId: number, tickType?: number, size?: number];
  tickGeneric: [reqId: number, tickType: number, value: number];
  tickString: [reqId: number, tickType: number, value: string];
  tickReqParams: [reqId: number, minTick: number, bboExchange: string, snapshotPermissions: number];
  tickSnapshotEnd: [reqId: number];
  error: [error: Error, code: number, reqId: number, advancedOrderReject?: unknown];
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
  reqMktData(
    reqId: number,
    contract: PortfolioContractSeed,
    genericTickList: string,
    snapshot: boolean,
    regulatorySnapshot: boolean,
  ): void;
  cancelMktData(reqId: number): void;
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
  applyCashBalance(currency: string, value: string): void;
  applyExchangeRate(currency: string, value: string): void;
  setBaseCurrency(currency: string): void;
  markInitialLoadComplete(): void;
  attachMarketHours(conId: number, marketHours: PositionMarketHours): void;
  snapshot(): PortfolioUpdate;
};

export type PortfolioState = {
  positions: Map<number, Position>;
  positionsMarketValue: number;
  positionsUnrealizedPnL: number;
  cashBalance: number;
  cashBalancesByCurrency: Map<string, number>;
  localCashBalancesByCurrency: Map<string, number>;
  exchangeRatesByCurrency: Map<string, number>;
  baseCurrencyCode: string | null;
  hasBaseCashBalance: boolean;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number;
  positionsPendingFxCount: number;
  positionsPendingFxByCurrency: Map<string, number>;
};
