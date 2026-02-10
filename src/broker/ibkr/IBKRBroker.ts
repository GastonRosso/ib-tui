import { IBApi, EventName, Contract } from "@stoqey/ib";
import type {
  Broker,
  ConnectionConfig,
  AccountSummary,
  Position,
  PositionMarketHours,
  Order,
  Quote,
  PortfolioUpdate,
} from "../types.js";
import { log } from "../../utils/logger.js";

const DEFAULT_CONFIG: ConnectionConfig = {
  host: process.env.IBKR_HOST || "127.0.0.1",
  port: parseInt(process.env.IBKR_PORT || "4001", 10),
  clientId: 1,
};

export class IBKRBroker implements Broker {
  private api: IBApi | null = null;
  private connected = false;
  private nextOrderId = 0;
  private accountId = "";
  private disconnectCallbacks: Set<() => void> = new Set();

  private setupEventHandlers(): void {
    if (!this.api) return;

    this.api.on(EventName.connected, () => {
      log("debug", "event.connected", "received");
      this.connected = true;
    });

    this.api.on(EventName.disconnected, () => {
      log("debug", "event.disconnected", "received");
      this.connected = false;
      this.disconnectCallbacks.forEach((cb) => cb());
    });

    this.api.on(EventName.nextValidId, (orderId: number) => {
      log("debug", "event.nextValidId", `orderId=${orderId}`);
      this.nextOrderId = orderId;
    });

    this.api.on(EventName.error, (err: Error, code: number, reqId: number) => {
      log("error", "error", `code=${code} reqId=${reqId} message=${err.message}`);
      console.error(`IBKR Error [${code}] reqId=${reqId}:`, err.message);
    });

    this.api.on(EventName.managedAccounts, (accountsList: string) => {
      const accounts = accountsList.split(",");
      if (accounts.length > 0) {
        this.accountId = accounts[0];
      }
      log("debug", "event.managedAccounts", `accounts=${accountsList} selectedAccount=${this.accountId}`);
    });
  }

  async connect(config: ConnectionConfig = DEFAULT_CONFIG): Promise<void> {
    log("info", "connection", `connect host=${config.host} port=${config.port} clientId=${config.clientId}`);
    this.api = new IBApi({
      host: config.host,
      port: config.port,
    });
    this.setupEventHandlers();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      this.api!.once(EventName.nextValidId, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.api!.connect(config.clientId);
    });
  }

  async disconnect(): Promise<void> {
    log("info", "connection", "disconnect requested");
    if (this.api) {
      this.api.disconnect();
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onDisconnect(callback: () => void): () => void {
    this.disconnectCallbacks.add(callback);
    return () => {
      this.disconnectCallbacks.delete(callback);
    };
  }

  async getAccountSummary(): Promise<AccountSummary> {
    // TODO: Implement using reqAccountSummary
    throw new Error("Not implemented");
  }

  async getPositions(): Promise<Position[]> {
    // TODO: Implement using reqPositions
    throw new Error("Not implemented");
  }

  async placeOrder(_order: Omit<Order, "id" | "status">): Promise<Order> {
    // TODO: Implement using placeOrder
    throw new Error("Not implemented");
  }

  async cancelOrder(orderId: number): Promise<void> {
    if (this.api) {
      this.api.cancelOrder(orderId);
    }
  }

  async getOpenOrders(): Promise<Order[]> {
    // TODO: Implement using reqOpenOrders
    throw new Error("Not implemented");
  }

  subscribeQuote(_symbol: string, _callback: (quote: Quote) => void): () => void {
    // TODO: Implement using reqMktData
    throw new Error("Not implemented");
  }

  subscribePortfolio(callback: (update: PortfolioUpdate) => void): () => void {
    if (!this.api) {
      throw new Error("Not connected");
    }

    const api = this.api;
    const positions = new Map<number, Position>();
    const marketHoursByConId = new Map<number, PositionMarketHours>();
    const reqIdToConId = new Map<number, number>();
    const pendingConIds = new Set<number>();
    let nextContractDetailsReqId = 90_000;
    let positionsMarketValue = 0;
    let cashBalance = 0;
    let initialLoadComplete = false;
    let lastPortfolioUpdateAt = Date.now();

    log("info", "subscription", `portfolio start account=${this.accountId || "<pending>"}`);

    const computeTotalEquity = (): number => {
      return positionsMarketValue + cashBalance;
    };

    const emitUpdate = () => {
      const totalEquity = computeTotalEquity();
      callback({
        positions: Array.from(positions.values()),
        positionsMarketValue,
        totalEquity,
        cashBalance,
        initialLoadComplete,
        lastPortfolioUpdateAt,
      });
    };

    const requestContractDetailsIfNeeded = (contract: Contract, conId: number) => {
      if (marketHoursByConId.has(conId) || pendingConIds.has(conId)) return;
      const reqId = nextContractDetailsReqId++;
      pendingConIds.add(conId);
      reqIdToConId.set(reqId, conId);
      log("debug", "event.reqContractDetails", `reqId=${reqId} conId=${conId} sym=${contract.symbol ?? ""}`);
      api.reqContractDetails(reqId, {
        conId,
        symbol: contract.symbol,
        currency: contract.currency,
        exchange: contract.exchange ?? "SMART",
        secType: contract.secType,
      });
    };

    const onContractDetails = (reqId: number, details: { contract?: { conId?: number }; timeZoneId?: string; liquidHours?: string; tradingHours?: string }) => {
      const conId = reqIdToConId.get(reqId) ?? details.contract?.conId;
      log("debug", "event.contractDetails", `reqId=${reqId} conId=${conId ?? "n/a"} tz=${details.timeZoneId ?? "n/a"} liquid=${(details.liquidHours ?? "n/a").slice(0, 60)} trading=${(details.tradingHours ?? "n/a").slice(0, 60)}`);
      if (!conId) return;

      marketHoursByConId.set(conId, {
        timeZoneId: details.timeZoneId ?? null,
        liquidHours: details.liquidHours ?? null,
        tradingHours: details.tradingHours ?? null,
      });

      const existing = positions.get(conId);
      if (existing) {
        positions.set(conId, { ...existing, marketHours: marketHoursByConId.get(conId) });
        emitUpdate();
      }
    };

    const onContractDetailsEnd = (reqId: number) => {
      const conId = reqIdToConId.get(reqId);
      if (conId) pendingConIds.delete(conId);
      reqIdToConId.delete(reqId);
    };

    const onPortfolioUpdate = (
      contract: Contract,
      pos: number,
      marketPrice: number,
      marketValue: number,
      avgCost?: number,
      unrealizedPnL?: number,
      realizedPnL?: number,
      accountName?: string
    ) => {
      log(
        "debug",
        "event.updatePortfolio",
        `received account=${accountName} conId=${contract.conId ?? "n/a"} sym=${contract.symbol ?? ""} qty=${pos} mktPrice=${marketPrice} mktValue=${marketValue}`
      );
      if (accountName !== this.accountId && this.accountId) {
        log("debug", "event.updatePortfolio", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }

      if (contract.conId === undefined || contract.conId === null) {
        log("debug", "event.updatePortfolio", "ignored missing conId");
        return;
      }
      const conId = contract.conId;
      const existing = positions.get(conId);

      const position: Position = {
        symbol: contract.symbol ?? "",
        quantity: pos,
        avgCost: avgCost ?? 0,
        marketValue,
        unrealizedPnL: unrealizedPnL ?? existing?.unrealizedPnL ?? 0,
        dailyPnL: 0,
        realizedPnL: realizedPnL ?? existing?.realizedPnL ?? 0,
        marketPrice,
        currency: contract.currency ?? "USD",
        conId,
        marketHours: marketHoursByConId.get(conId),
      };

      if (pos === 0) {
        positions.delete(conId);
      } else {
        positions.set(conId, position);
        requestContractDetailsIfNeeded(contract, conId);
      }

      positionsMarketValue = Array.from(positions.values()).reduce(
        (sum, p) => sum + p.marketValue,
        0
      );

      lastPortfolioUpdateAt = Date.now();
      emitUpdate();
    };

    const onAccountValue = (
      key: string,
      value: string,
      currency: string,
      accountName: string
    ) => {
      log("debug", "event.accountValue", `received key=${key} value=${value} currency=${currency} account=${accountName}`);
      if (accountName !== this.accountId && this.accountId) {
        log("debug", "event.accountValue", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }
      if (key === "TotalCashBalance" && currency === "BASE") {
        cashBalance = parseFloat(value) || 0;
        lastPortfolioUpdateAt = Date.now();
        emitUpdate();
      } else {
        log("debug", "event.accountValue", `ignored key=${key} currency=${currency}`);
      }
    };

    const onAccountDownloadEnd = (accountName: string) => {
      log("debug", "event.accountDownloadEnd", `received account=${accountName}`);
      if (accountName !== this.accountId && this.accountId) {
        log("debug", "event.accountDownloadEnd", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }
      initialLoadComplete = true;
      lastPortfolioUpdateAt = Date.now();
      emitUpdate();
    };

    api.on(EventName.updatePortfolio, onPortfolioUpdate);
    api.on(EventName.updateAccountValue, onAccountValue);
    api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);
    api.on(EventName.contractDetails, onContractDetails);
    api.on(EventName.contractDetailsEnd, onContractDetailsEnd);

    log("info", "subscription", `reqAccountUpdates start account=${this.accountId}`);
    api.reqAccountUpdates(true, this.accountId);

    return () => {
      api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
      api.removeListener(EventName.updateAccountValue, onAccountValue);
      api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);
      api.removeListener(EventName.contractDetails, onContractDetails);
      api.removeListener(EventName.contractDetailsEnd, onContractDetailsEnd);

      log("info", "subscription", `reqAccountUpdates stop account=${this.accountId}`);
      api.reqAccountUpdates(false, this.accountId);
      log("info", "subscription", "portfolio stop");
    };
  }
}
