import { EventName } from "@stoqey/ib";
import type { PortfolioUpdate } from "../../types.js";
import { createPortfolioProjection } from "./portfolioProjection.js";
import { createContractDetailsTracker } from "./contractDetailsTracker.js";
import type { PortfolioApi, PortfolioContractSeed, ContractDetailsPayload } from "./types.js";
import type { LogLevel } from "../../../utils/logger.js";

type LogFn = (level: LogLevel, stream: string, detail: string) => void;

const noop: LogFn = () => {};
const FX_REQ_ID_START = 700_000;
const CONTRACT_DETAILS_TIMEOUT_MS = 20_000;
const FX_INITIAL_TICK_TIMEOUT_MS = 20_000;
const FX_RATE_TIMEOUT_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 5_000;
const TICK_BID = 1;
const TICK_ASK = 2;
const TICK_LAST = 4;
const TICK_MARK = 37;
const TICK_DELAYED_BID = 66;
const TICK_DELAYED_ASK = 67;
const TICK_DELAYED_LAST = 68;

type FxQuoteState = {
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
};

type ContractDetailsRequestState = {
  conId: number;
  symbol: string;
  requestedAtMs: number;
  lastWarnAtMs: number | null;
  sawDetails: boolean;
  sawError: boolean;
};

type FxRequestState = {
  currency: string;
  baseCurrency: string;
  requestedAtMs: number;
  lastTickAtMs: number | null;
  lastWarnAtMs: number | null;
  sawAnyTick: boolean;
  sawRate: boolean;
  sawError: boolean;
};

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
  const liveFxEnabled = process.env.IBKR_DISABLE_LIVE_FX !== "1";
  const localCashCurrencies = new Set<string>();
  const positionCurrencies = new Set<string>();
  const fxReqIdByCurrency = new Map<string, number>();
  const fxCurrencyByReqId = new Map<number, string>();
  const fxQuoteByReqId = new Map<number, FxQuoteState>();
  const liveFxRateCurrencies = new Set<string>();
  const lastAppliedFxRateByCurrency = new Map<string, number>();
  const pendingContractDetailsByReqId = new Map<number, ContractDetailsRequestState>();
  const fxRequestStateByReqId = new Map<number, FxRequestState>();
  let nextFxReqId = FX_REQ_ID_START;
  let baseCurrencyCode: string | null = null;
  let initialAccountDownloadComplete = false;

  const getAccountId = typeof accountIdOrFn === "function" ? accountIdOrFn : () => accountIdOrFn;

  const emit = () => callback(projection.snapshot());
  const accountMatches = (name?: string) => {
    const current = getAccountId();
    return !current || name === current;
  };

  const ensureFxSubscription = (currency: string): void => {
    if (!liveFxEnabled) return;
    if (!initialAccountDownloadComplete) return;
    if (!currency || currency === "BASE") return;
    if (!baseCurrencyCode || currency === baseCurrencyCode) return;
    if (fxReqIdByCurrency.has(currency)) return;

    const reqId = nextFxReqId++;
    const contract: PortfolioContractSeed = {
      symbol: currency,
      currency: baseCurrencyCode,
      exchange: "IDEALPRO",
      secType: "CASH",
    };

    fxReqIdByCurrency.set(currency, reqId);
    fxCurrencyByReqId.set(reqId, currency);
    fxQuoteByReqId.set(reqId, {});
    fxRequestStateByReqId.set(reqId, {
      currency,
      baseCurrency: baseCurrencyCode,
      requestedAtMs: now(),
      lastTickAtMs: null,
      lastWarnAtMs: null,
      sawAnyTick: false,
      sawRate: false,
      sawError: false,
    });

    log("info", "subscription.fx", `reqMktData start reqId=${reqId} pair=${currency}.${baseCurrencyCode}`);
    try {
      api.reqMktData(reqId, contract, "", false, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("error", "subscription.fx", `reqMktData failed reqId=${reqId} pair=${currency}.${baseCurrencyCode} error=${message}`);
      fxReqIdByCurrency.delete(currency);
      fxCurrencyByReqId.delete(reqId);
      fxQuoteByReqId.delete(reqId);
      fxRequestStateByReqId.delete(reqId);
    }
  };

  const ensureFxSubscriptions = (): void => {
    for (const currency of localCashCurrencies) {
      ensureFxSubscription(currency);
    }
    for (const currency of positionCurrencies) {
      ensureFxSubscription(currency);
    }
  };

  const updateBaseCurrencyCode = (key: string, currency: string): void => {
    if (!currency || currency === "BASE") return;
    if (key !== "TotalCashValue" && key !== "NetLiquidation") return;

    if (baseCurrencyCode === currency) return;

    if (baseCurrencyCode && baseCurrencyCode !== currency) {
      log("warn", "subscription.fx", `base currency changed ${baseCurrencyCode}->${currency}`);
    }

    baseCurrencyCode = currency;
    projection.setBaseCurrency(currency);
    log("info", "subscription.fx", `base currency detected=${baseCurrencyCode}`);
    if (initialAccountDownloadComplete) ensureFxSubscriptions();
  };

  const calculateFxRate = (quote: FxQuoteState): number | null => {
    if (quote.bid !== undefined && quote.ask !== undefined && quote.bid > 0 && quote.ask > 0) {
      return (quote.bid + quote.ask) / 2;
    }
    if (quote.mark !== undefined && quote.mark > 0) return quote.mark;
    if (quote.last !== undefined && quote.last > 0) return quote.last;
    return null;
  };

  const markFxTick = (reqId: number): FxRequestState | null => {
    const state = fxRequestStateByReqId.get(reqId);
    if (!state) return null;
    state.sawAnyTick = true;
    state.lastTickAtMs = now();
    return state;
  };

  const runWatchdog = (): void => {
    const currentMs = now();

    for (const [reqId, state] of pendingContractDetailsByReqId.entries()) {
      if (state.sawDetails || state.sawError) continue;
      const ageMs = currentMs - state.requestedAtMs;
      if (ageMs < CONTRACT_DETAILS_TIMEOUT_MS) continue;
      if (state.lastWarnAtMs !== null && currentMs - state.lastWarnAtMs < CONTRACT_DETAILS_TIMEOUT_MS) continue;
      state.lastWarnAtMs = currentMs;
      log(
        "warn",
        "watchdog.contractDetails",
        `stalled reqId=${reqId} conId=${state.conId} sym=${state.symbol} ageMs=${ageMs}`
      );
    }

    for (const [reqId, state] of fxRequestStateByReqId.entries()) {
      if (state.sawError) continue;
      const ageMs = currentMs - state.requestedAtMs;
      const warnCooldown = state.sawAnyTick ? FX_RATE_TIMEOUT_MS : FX_INITIAL_TICK_TIMEOUT_MS;
      if (ageMs < warnCooldown) continue;
      if (state.lastWarnAtMs !== null && currentMs - state.lastWarnAtMs < warnCooldown) continue;
      state.lastWarnAtMs = currentMs;

      if (!state.sawAnyTick) {
        log(
          "warn",
          "watchdog.fx",
          `no ticks reqId=${reqId} pair=${state.currency}.${state.baseCurrency} ageMs=${ageMs}`
        );
      } else if (!state.sawRate) {
        const sinceLastTickMs = state.lastTickAtMs === null ? -1 : currentMs - state.lastTickAtMs;
        log(
          "warn",
          "watchdog.fx",
          `ticks without rate reqId=${reqId} pair=${state.currency}.${state.baseCurrency} ageMs=${ageMs} sinceLastTickMs=${sinceLastTickMs}`
        );
      }
    }
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
    if (pos !== 0 && contract.currency && contract.currency !== "BASE") {
      positionCurrencies.add(contract.currency);
      if (initialAccountDownloadComplete) ensureFxSubscription(contract.currency);
    }
    if (pos !== 0 && contract.conId != null) {
      const cached = tracker.getCachedMarketHours(contract.conId);
      if (cached) projection.attachMarketHours(contract.conId, cached);
    }
    const req = tracker.nextRequest(contract);
    if (req) {
      log("debug", "event.reqContractDetails", `reqId=${req.reqId} conId=${req.contract.conId} sym=${req.contract.symbol ?? ""}`);
      pendingContractDetailsByReqId.set(req.reqId, {
        conId: req.contract.conId,
        symbol: req.contract.symbol ?? "",
        requestedAtMs: now(),
        lastWarnAtMs: null,
        sawDetails: false,
        sawError: false,
      });
      try {
        api.reqContractDetails(req.reqId, req.contract);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("error", "event.reqContractDetails", `failed reqId=${req.reqId} conId=${req.contract.conId} error=${message}`);
        pendingContractDetailsByReqId.delete(req.reqId);
      }
    }
    emit();
  };

  const onAccountValue = (key: string, value: string, currency: string, accountName: string) => {
    log("debug", "event.accountValue", `received key=${key} value=${value} currency=${currency} account=${accountName}`);
    if (!accountMatches(accountName)) {
      log("debug", "event.accountValue", `ignored account mismatch expected=${getAccountId()} got=${accountName}`);
      return;
    }

    updateBaseCurrencyCode(key, currency);

    if (key !== "TotalCashBalance" && key !== "ExchangeRate") {
      log("debug", "event.accountValue", `ignored key=${key} currency=${currency}`);
      return;
    }
    if (!currency) {
      log("debug", "event.accountValue", "ignored missing currency");
      return;
    }

    if (key === "TotalCashBalance" && currency !== "BASE") {
      localCashCurrencies.add(currency);
      if (initialAccountDownloadComplete) ensureFxSubscription(currency);
    }

    if (key === "ExchangeRate") {
      if (liveFxRateCurrencies.has(currency)) {
        log("debug", "event.accountValue", `ignored stale ExchangeRate for ${currency}; live FX active`);
        return;
      }
      projection.applyExchangeRate(currency, value);
    } else {
      projection.applyCashBalance(currency, value);
    }
    emit();
  };

  const onTickPrice = (reqId: number, tickType: number, price: number) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    if (!Number.isFinite(price) || price <= 0) return;

    const quote = fxQuoteByReqId.get(reqId) ?? {};
    const fxState = markFxTick(reqId);

    if (tickType === TICK_BID || tickType === TICK_DELAYED_BID) {
      quote.bid = price;
    } else if (tickType === TICK_ASK || tickType === TICK_DELAYED_ASK) {
      quote.ask = price;
    } else if (tickType === TICK_MARK) {
      quote.mark = price;
    } else if (tickType === TICK_LAST || tickType === TICK_DELAYED_LAST) {
      quote.last = price;
    } else {
      return;
    }

    log("debug", "event.tickPrice.fx", `reqId=${reqId} currency=${currency} tickType=${tickType} price=${price}`);
    fxQuoteByReqId.set(reqId, quote);

    const nextRate = calculateFxRate(quote);
    if (nextRate === null) return;

    const previousRate = lastAppliedFxRateByCurrency.get(currency);
    if (previousRate !== undefined && Math.abs(previousRate - nextRate) < 1e-9) return;

    lastAppliedFxRateByCurrency.set(currency, nextRate);
    liveFxRateCurrencies.add(currency);
    if (fxState) fxState.sawRate = true;
    projection.applyExchangeRate(currency, String(nextRate));
    log(
      "debug",
      "event.fxRate",
      `reqId=${reqId} currency=${currency} base=${baseCurrencyCode ?? "n/a"} rate=${nextRate.toFixed(6)} bid=${quote.bid?.toFixed(6) ?? "n/a"} ask=${quote.ask?.toFixed(6) ?? "n/a"}`
    );
    emit();
  };

  const onTickSize = (reqId: number, tickType?: number, size?: number) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    markFxTick(reqId);
    log("debug", "event.tickSize.fx", `reqId=${reqId} currency=${currency} tickType=${tickType ?? "n/a"} size=${size ?? "n/a"}`);
  };

  const onTickGeneric = (reqId: number, tickType: number, value: number) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    markFxTick(reqId);
    log("debug", "event.tickGeneric.fx", `reqId=${reqId} currency=${currency} tickType=${tickType} value=${value}`);
  };

  const onTickString = (reqId: number, tickType: number, value: string) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    markFxTick(reqId);
    log("debug", "event.tickString.fx", `reqId=${reqId} currency=${currency} tickType=${tickType} value=${value}`);
  };

  const onTickReqParams = (reqId: number, minTick: number, bboExchange: string, snapshotPermissions: number) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    markFxTick(reqId);
    log(
      "debug",
      "event.tickReqParams.fx",
      `reqId=${reqId} currency=${currency} minTick=${minTick} bboExchange=${bboExchange || "n/a"} snapshotPermissions=${snapshotPermissions}`
    );
  };

  const onTickSnapshotEnd = (reqId: number) => {
    const currency = fxCurrencyByReqId.get(reqId);
    if (!currency) return;
    markFxTick(reqId);
    log("debug", "event.tickSnapshotEnd.fx", `reqId=${reqId} currency=${currency}`);
  };

  const onError = (error: Error, code: number, reqId: number) => {
    const contractState = pendingContractDetailsByReqId.get(reqId);
    if (contractState) {
      contractState.sawError = true;
      log(
        "warn",
        "event.error.contractDetails",
        `reqId=${reqId} conId=${contractState.conId} sym=${contractState.symbol} code=${code} message=${error.message}`
      );
    }

    const fxState = fxRequestStateByReqId.get(reqId);
    if (!fxState) return;
    fxState.sawError = true;
    log(
      "warn",
      "event.error.fx",
      `reqId=${reqId} pair=${fxState.currency}.${fxState.baseCurrency} code=${code} message=${error.message}`
    );
  };

  const onAccountTime = (timestamp: string) => {
    log("debug", "event.accountTime", `timestamp=${timestamp}`);
  };

  const onAccountDownloadEnd = (accountName: string) => {
    log("debug", "event.accountDownloadEnd", `received account=${accountName}`);
    if (!accountMatches(accountName)) {
      log("debug", "event.accountDownloadEnd", `ignored account mismatch expected=${getAccountId()} got=${accountName}`);
      return;
    }
    initialAccountDownloadComplete = true;
    projection.markInitialLoadComplete();
    ensureFxSubscriptions();
    log(
      "info",
      "subscription.watchdog",
      `after accountDownloadEnd pendingContractDetails=${pendingContractDetailsByReqId.size} pendingFx=${fxRequestStateByReqId.size}`
    );
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
    const state = pendingContractDetailsByReqId.get(reqId);
    if (state) state.sawDetails = true;
    if (!hit) return;
    projection.attachMarketHours(hit.conId, hit.marketHours);
    emit();
  };

  const onContractDetailsEnd = (reqId: number) => {
    const state = pendingContractDetailsByReqId.get(reqId);
    if (state) {
      const ageMs = now() - state.requestedAtMs;
      log(
        "debug",
        "event.contractDetailsEnd",
        `reqId=${reqId} conId=${state.conId} sym=${state.symbol} ageMs=${ageMs} sawDetails=${state.sawDetails} sawError=${state.sawError}`
      );
      pendingContractDetailsByReqId.delete(reqId);
    } else {
      log("debug", "event.contractDetailsEnd", `reqId=${reqId} state=n/a`);
    }
    tracker.onContractDetailsEnd(reqId);
  };

  const watchdog = setInterval(runWatchdog, WATCHDOG_INTERVAL_MS);
  if (typeof watchdog.unref === "function") watchdog.unref();

  api.on(EventName.updatePortfolio, onPortfolioUpdate);
  api.on(EventName.updateAccountValue, onAccountValue);
  api.on(EventName.updateAccountTime, onAccountTime);
  api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);
  api.on(EventName.contractDetails, onContractDetails);
  api.on(EventName.contractDetailsEnd, onContractDetailsEnd);
  api.on(EventName.tickPrice, onTickPrice);
  api.on(EventName.tickSize, onTickSize);
  api.on(EventName.tickGeneric, onTickGeneric);
  api.on(EventName.tickString, onTickString);
  api.on(EventName.tickReqParams, onTickReqParams);
  api.on(EventName.tickSnapshotEnd, onTickSnapshotEnd);
  api.on(EventName.error, onError);

  log("info", "subscription", `portfolio start account=${getAccountId() || "<pending>"}`);
  log("info", "subscription.fx", `live fx ${liveFxEnabled ? "enabled" : "disabled"}`);
  log(
    "info",
    "subscription.watchdog",
    `enabled contractDetailsTimeoutMs=${CONTRACT_DETAILS_TIMEOUT_MS} fxInitialTickTimeoutMs=${FX_INITIAL_TICK_TIMEOUT_MS} fxRateTimeoutMs=${FX_RATE_TIMEOUT_MS} intervalMs=${WATCHDOG_INTERVAL_MS}`
  );
  api.reqAccountUpdates(true, getAccountId());

  return () => {
    clearInterval(watchdog);
    api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
    api.removeListener(EventName.updateAccountValue, onAccountValue);
    api.removeListener(EventName.updateAccountTime, onAccountTime);
    api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);
    api.removeListener(EventName.contractDetails, onContractDetails);
    api.removeListener(EventName.contractDetailsEnd, onContractDetailsEnd);
    api.removeListener(EventName.tickPrice, onTickPrice);
    api.removeListener(EventName.tickSize, onTickSize);
    api.removeListener(EventName.tickGeneric, onTickGeneric);
    api.removeListener(EventName.tickString, onTickString);
    api.removeListener(EventName.tickReqParams, onTickReqParams);
    api.removeListener(EventName.tickSnapshotEnd, onTickSnapshotEnd);
    api.removeListener(EventName.error, onError);

    if (pendingContractDetailsByReqId.size > 0) {
      const pending = Array.from(pendingContractDetailsByReqId.entries())
        .map(([reqId, state]) => `${reqId}:${state.symbol || state.conId}`)
        .join(",");
      log("warn", "subscription.watchdog", `unsubscribe with pending contract details reqIds=${pending}`);
    }
    if (fxRequestStateByReqId.size > 0) {
      const pending = Array.from(fxRequestStateByReqId.entries())
        .map(([reqId, state]) => `${reqId}:${state.currency}.${state.baseCurrency}:tick=${state.sawAnyTick ? 1 : 0}:rate=${state.sawRate ? 1 : 0}:err=${state.sawError ? 1 : 0}`)
        .join(",");
      log("warn", "subscription.watchdog", `unsubscribe with pending fx reqIds=${pending}`);
    }

    for (const [currency, reqId] of fxReqIdByCurrency.entries()) {
      log("info", "subscription.fx", `cancelMktData reqId=${reqId} pair=${currency}.${baseCurrencyCode ?? "n/a"}`);
      try {
        api.cancelMktData(reqId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", "subscription.fx", `cancelMktData failed reqId=${reqId} pair=${currency}.${baseCurrencyCode ?? "n/a"} error=${message}`);
      }
    }

    log("info", "subscription", `reqAccountUpdates stop account=${getAccountId()}`);
    api.reqAccountUpdates(false, getAccountId());
    log("info", "subscription", "portfolio stop");
  };
};
