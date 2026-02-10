import type { PositionMarketHours } from "../../types.js";
import type { PortfolioContractSeed, ContractDetailsPayload } from "./types.js";

export type ContractDetailsRequest = {
  reqId: number;
  contract: {
    conId: number;
    symbol?: string;
    currency?: string;
    exchange?: string;
    secType?: string;
  };
};

export type ContractDetailsHit = {
  conId: number;
  marketHours: PositionMarketHours;
};

export const createContractDetailsTracker = (startReqId = 90_000) => {
  const marketHoursByConId = new Map<number, PositionMarketHours>();
  const reqIdToConId = new Map<number, number>();
  const pendingConIds = new Set<number>();
  let nextReqId = startReqId;

  const nextRequest = (contract: PortfolioContractSeed): ContractDetailsRequest | null => {
    const conId = contract.conId;
    if (conId === undefined || conId === null) return null;
    if (marketHoursByConId.has(conId) || pendingConIds.has(conId)) return null;
    const reqId = nextReqId++;
    reqIdToConId.set(reqId, conId);
    pendingConIds.add(conId);
    return {
      reqId,
      contract: {
        conId,
        symbol: contract.symbol,
        currency: contract.currency,
        exchange: contract.exchange ?? "SMART",
        secType: contract.secType,
      },
    };
  };

  const onContractDetails = (reqId: number, details: ContractDetailsPayload): ContractDetailsHit | null => {
    const conId = reqIdToConId.get(reqId) ?? details.contract?.conId;
    if (!conId) return null;
    const marketHours: PositionMarketHours = {
      timeZoneId: details.timeZoneId ?? null,
      liquidHours: details.liquidHours ?? null,
      tradingHours: details.tradingHours ?? null,
    };
    marketHoursByConId.set(conId, marketHours);
    return { conId, marketHours };
  };

  const onContractDetailsEnd = (reqId: number): void => {
    const conId = reqIdToConId.get(reqId);
    if (conId) pendingConIds.delete(conId);
    reqIdToConId.delete(reqId);
  };

  const getCachedMarketHours = (conId: number): PositionMarketHours | undefined =>
    marketHoursByConId.get(conId);

  return { nextRequest, onContractDetails, onContractDetailsEnd, getCachedMarketHours };
};
