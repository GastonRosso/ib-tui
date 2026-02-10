import { EventName } from "@stoqey/ib";
import type { PortfolioUpdate } from "../../types.js";
import { createPortfolioProjection } from "./portfolioProjection.js";
import { createContractDetailsTracker } from "./contractDetailsTracker.js";
import type { PortfolioApi, PortfolioContractSeed, ContractDetailsPayload } from "./types.js";
import type { LogLevel } from "../../../utils/logger.js";

type LogFn = (level: LogLevel, stream: string, detail: string) => void;

const noop: LogFn = () => {};

type Params = {
  api: PortfolioApi;
  accountId: string | (() => string);
  callback: (update: PortfolioUpdate) => void;
  now?: () => number;
  log?: LogFn;
};

export const createPortfolioSubscription = ({ api, accountId: accountIdOrFn, callback, now = () => Date.now(), log = noop }: Params): (() => void) => {
  const projection = createPortfolioProjection(now);
  const tracker = createContractDetailsTracker();

  const getAccountId = typeof accountIdOrFn === "function" ? accountIdOrFn : () => accountIdOrFn;

  const emit = () => callback(projection.snapshot());
  const accountMatches = (name?: string) => {
    const current = getAccountId();
    return !current || name === current;
  };

  const onPortfolioUpdate = (
    contract: PortfolioContractSeed,
    pos: number,
    marketPrice: number,
    marketValue: number,
    avgCost?: number,
    unrealizedPnL?: number,
    realizedPnL?: number,
    accountName?: string,
  ) => {
    log(
      "debug",
      "event.updatePortfolio",
      `received account=${accountName} conId=${contract.conId ?? "n/a"} sym=${contract.symbol ?? ""} qty=${pos} mktPrice=${marketPrice} mktValue=${marketValue}`
    );
    if (!accountMatches(accountName)) {
      log("debug", "event.updatePortfolio", `ignored account mismatch expected=${getAccountId()} got=${accountName}`);
      return;
    }
    if (contract.conId === undefined || contract.conId === null) {
      log("debug", "event.updatePortfolio", "ignored missing conId");
      return;
    }
    projection.applyPortfolioUpdate({ contract, pos, marketPrice, marketValue, avgCost, unrealizedPnL, realizedPnL });
    if (pos !== 0 && contract.conId != null) {
      const cached = tracker.getCachedMarketHours(contract.conId);
      if (cached) projection.attachMarketHours(contract.conId, cached);
    }
    const req = tracker.nextRequest(contract);
    if (req) {
      log("debug", "event.reqContractDetails", `reqId=${req.reqId} conId=${req.contract.conId} sym=${req.contract.symbol ?? ""}`);
      api.reqContractDetails(req.reqId, req.contract);
    }
    emit();
  };

  const onAccountValue = (key: string, value: string, currency: string, accountName: string) => {
    log("debug", "event.accountValue", `received key=${key} value=${value} currency=${currency} account=${accountName}`);
    if (!accountMatches(accountName)) {
      log("debug", "event.accountValue", `ignored account mismatch expected=${getAccountId()} got=${accountName}`);
      return;
    }
    if (key !== "TotalCashBalance" || currency !== "BASE") {
      log("debug", "event.accountValue", `ignored key=${key} currency=${currency}`);
      return;
    }
    projection.applyCashBalance(value);
    emit();
  };

  const onAccountDownloadEnd = (accountName: string) => {
    log("debug", "event.accountDownloadEnd", `received account=${accountName}`);
    if (!accountMatches(accountName)) {
      log("debug", "event.accountDownloadEnd", `ignored account mismatch expected=${getAccountId()} got=${accountName}`);
      return;
    }
    projection.markInitialLoadComplete();
    emit();
  };

  const onContractDetails = (
    reqId: number,
    details: ContractDetailsPayload,
  ) => {
    log(
      "debug",
      "event.contractDetails",
      `reqId=${reqId} conId=${details.contract?.conId ?? "n/a"} tz=${details.timeZoneId ?? "n/a"} liquid=${(details.liquidHours ?? "n/a").slice(0, 60)} trading=${(details.tradingHours ?? "n/a").slice(0, 60)}`
    );
    const hit = tracker.onContractDetails(reqId, details);
    if (!hit) return;
    projection.attachMarketHours(hit.conId, hit.marketHours);
    emit();
  };

  const onContractDetailsEnd = (reqId: number) => tracker.onContractDetailsEnd(reqId);

  api.on(EventName.updatePortfolio, onPortfolioUpdate);
  api.on(EventName.updateAccountValue, onAccountValue);
  api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);
  api.on(EventName.contractDetails, onContractDetails);
  api.on(EventName.contractDetailsEnd, onContractDetailsEnd);

  log("info", "subscription", `portfolio start account=${getAccountId() || "<pending>"}`);
  api.reqAccountUpdates(true, getAccountId());

  return () => {
    api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
    api.removeListener(EventName.updateAccountValue, onAccountValue);
    api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);
    api.removeListener(EventName.contractDetails, onContractDetails);
    api.removeListener(EventName.contractDetailsEnd, onContractDetailsEnd);
    log("info", "subscription", `reqAccountUpdates stop account=${getAccountId()}`);
    api.reqAccountUpdates(false, getAccountId());
    log("info", "subscription", "portfolio stop");
  };
};
