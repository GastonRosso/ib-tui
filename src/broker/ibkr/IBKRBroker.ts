import { IBApi, EventName, Contract } from "@stoqey/ib";
import type {
  Broker,
  ConnectionConfig,
  AccountSummary,
  Position,
  Order,
  Quote,
  PortfolioUpdate,
} from "../types.js";
import { debugLog } from "./debug.js";

const DEFAULT_CONFIG: ConnectionConfig = {
  host: process.env.IBKR_HOST || "127.0.0.1",
  port: parseInt(process.env.IBKR_PORT || "4001", 10),
  clientId: 1,
};

export class IBKRBroker implements Broker {
  private api: IBApi | null = null;
  private connected = false;
  private nextOrderId = 0;
  private nextReqId = 1000;
  private accountId = "";
  private disconnectCallbacks: Set<() => void> = new Set();

  private getNextReqId(): number {
    return this.nextReqId++;
  }

  private setupEventHandlers(): void {
    if (!this.api) return;

    this.api.on(EventName.connected, () => {
      debugLog("connection", "connected");
      this.connected = true;
    });

    this.api.on(EventName.disconnected, () => {
      debugLog("connection", "disconnected");
      this.connected = false;
      this.disconnectCallbacks.forEach((cb) => cb());
    });

    this.api.on(EventName.nextValidId, (orderId: number) => {
      debugLog("connection", `nextValidId=${orderId}`);
      this.nextOrderId = orderId;
    });

    this.api.on(EventName.error, (err: Error, code: number, reqId: number) => {
      debugLog("error", `code=${code} reqId=${reqId} message=${err.message}`);
      console.error(`IBKR Error [${code}] reqId=${reqId}:`, err.message);
    });

    this.api.on(EventName.managedAccounts, (accountsList: string) => {
      const accounts = accountsList.split(",");
      if (accounts.length > 0) {
        this.accountId = accounts[0];
      }
      debugLog("connection", `managedAccounts=${accountsList} selectedAccount=${this.accountId}`);
    });
  }

  async connect(config: ConnectionConfig = DEFAULT_CONFIG): Promise<void> {
    debugLog("connection", `connect host=${config.host} port=${config.port} clientId=${config.clientId}`);
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
    debugLog("connection", "disconnect requested");
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
    let positionsMarketValue = 0;
    let accountDailyPnL = 0;
    let cashBalance = 0;
    let netLiquidation: number | null = null;
    let initialLoadComplete = false;
    let positionPnlReady = false;
    let accountPnlReady = false;

    const pnlReqId = this.getNextReqId();
    const pnlSingleReqIds = new Map<number, number>();
    const pnlSingleActive = new Set<number>();
    const pnlSingleLastTickAt = new Map<number, number>();
    debugLog("subscribe", `portfolio start account=${this.accountId || "<pending>"} pnlReqId=${pnlReqId}`);

    const computeTotalEquity = (): number => {
      return positionsMarketValue + cashBalance;
    };

    const emitUpdate = () => {
      const totalEquity = computeTotalEquity();
      const netLiqDetail = netLiquidation === null ? "n/a" : netLiquidation.toFixed(2);
      const netLiqDiff = netLiquidation === null ? "n/a" : (totalEquity - netLiquidation).toFixed(2);
      debugLog("emit", `positionsMV=${positionsMarketValue.toFixed(2)} cash=${cashBalance.toFixed(2)} netLiq=${netLiqDetail} totalEquity=${totalEquity.toFixed(2)} diffVsNetLiq=${netLiqDiff}`);
      callback({
        positions: Array.from(positions.values()),
        positionsMarketValue,
        totalEquity,
        accountDailyPnL,
        cashBalance,
        initialLoadComplete,
        positionPnlReady,
        accountPnlReady,
      });
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
      debugLog(
        "updatePortfolio",
        `received account=${accountName} conId=${contract.conId ?? "n/a"} sym=${contract.symbol ?? ""} qty=${pos} mktPrice=${marketPrice} mktValue=${marketValue}`
      );
      if (accountName !== this.accountId && this.accountId) {
        debugLog("updatePortfolio", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }

      // Guard against missing contract ids to avoid collapsing distinct positions
      if (contract.conId === undefined || contract.conId === null) {
        debugLog("updatePortfolio", "ignored missing conId");
        return;
      }
      const conId = contract.conId;
      const existing = positions.get(conId);
      const lastPnLSingleTickAt = pnlSingleLastTickAt.get(conId);
      const preserveRealtimeValue =
        existing !== undefined &&
        pnlSingleActive.has(conId) &&
        lastPnLSingleTickAt !== undefined &&
        Date.now() - lastPnLSingleTickAt <= 3000 &&
        existing.quantity === pos;

      const position: Position = {
        symbol: contract.symbol ?? "",
        quantity: pos,
        avgCost: avgCost ?? 0,
        marketValue: preserveRealtimeValue ? existing.marketValue : marketValue,
        unrealizedPnL: unrealizedPnL ?? existing?.unrealizedPnL ?? 0,
        dailyPnL: existing?.dailyPnL ?? 0,
        realizedPnL: realizedPnL ?? existing?.realizedPnL ?? 0,
        marketPrice: preserveRealtimeValue ? existing.marketPrice : marketPrice,
        currency: contract.currency ?? "USD",
        conId,
      };

      if (pos === 0) {
        positions.delete(conId);
        pnlSingleActive.delete(conId);
        pnlSingleLastTickAt.delete(conId);
        const reqId = pnlSingleReqIds.get(conId);
        if (reqId !== undefined) {
          debugLog("subscription", `cancel reqPnLSingle conId=${conId} reqId=${reqId}`);
          api.cancelPnLSingle(reqId);
          pnlSingleReqIds.delete(conId);
        }
      } else {
        positions.set(conId, position);
        if (!pnlSingleReqIds.has(conId)) {
          const reqId = this.getNextReqId();
          pnlSingleReqIds.set(conId, reqId);
          debugLog("subscription", `start reqPnLSingle conId=${conId} reqId=${reqId}`);
          api.reqPnLSingle(reqId, this.accountId, "", conId);
        }
      }

      positionsMarketValue = Array.from(positions.values()).reduce(
        (sum, p) => sum + p.marketValue,
        0
      );

      emitUpdate();
    };

    const onPnL = (
      reqId: number,
      dailyPnL: number,
      _unrealizedPnL?: number,
      _realizedPnL?: number
    ) => {
      debugLog("pnl", `received reqId=${reqId} expectedReqId=${pnlReqId} accountDailyPnL=${dailyPnL}`);
      if (reqId === pnlReqId) {
        accountDailyPnL = dailyPnL;
        accountPnlReady = true;
        emitUpdate();
      } else {
        debugLog("pnl", `ignored reqId mismatch expected=${pnlReqId} got=${reqId}`);
      }
    };

    const onPnLSingle = (
      reqId: number,
      pos: number,
      dailyPnL: number,
      unrealizedPnL: number | undefined,
      realizedPnL: number | undefined,
      value: number
    ) => {
      debugLog("pnlSingle", `received reqId=${reqId} pos=${pos} dailyPnL=${dailyPnL} unrealPnL=${unrealizedPnL} realPnL=${realizedPnL} value=${value}`);
      let matched = false;
      for (const [conId, rid] of pnlSingleReqIds.entries()) {
        if (rid === reqId) {
          matched = true;
          const existing = positions.get(conId);
          if (existing) {
            pnlSingleActive.add(conId);
            pnlSingleLastTickAt.set(conId, Date.now());
            positionPnlReady = true;

            const quantity = pos !== 0 && Number.isFinite(pos) ? pos : existing.quantity;
            const validValue = Number.isFinite(value) && Math.abs(value) < 1e100;

            let marketValue = existing.marketValue;
            let marketPrice = existing.marketPrice;
            if (validValue) {
              marketValue = value;
              if (quantity !== 0) {
                marketPrice = value / quantity;
              }
            } else if (unrealizedPnL !== undefined && Number.isFinite(unrealizedPnL)) {
              const derivedValue = quantity * existing.avgCost + unrealizedPnL;
              marketValue = derivedValue;
              if (quantity !== 0) {
                marketPrice = derivedValue / quantity;
              }
              debugLog("pnlSingle", `derivedValueFromUnrealized conId=${conId} derivedValue=${derivedValue}`);
            } else {
              debugLog("pnlSingle", `keptExistingValue conId=${conId} existingValue=${existing.marketValue}`);
            }

            positions.set(conId, {
              ...existing,
              quantity,
              marketValue,
              marketPrice,
              unrealizedPnL: unrealizedPnL ?? existing.unrealizedPnL,
              realizedPnL: realizedPnL ?? existing.realizedPnL,
              dailyPnL,
            });

            positionsMarketValue = Array.from(positions.values()).reduce(
              (sum, p) => sum + p.marketValue,
              0
            );
          }
          emitUpdate();
          break;
        }
      }
      if (!matched) {
        debugLog("pnlSingle", `ignored unknown reqId=${reqId}`);
      }
    };

    const onAccountValue = (
      key: string,
      value: string,
      currency: string,
      accountName: string
    ) => {
      debugLog("accountValue", `received key=${key} value=${value} currency=${currency} account=${accountName}`);
      if (accountName !== this.accountId && this.accountId) {
        debugLog("accountValue", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }
      if (key === "TotalCashBalance" && currency === "BASE") {
        cashBalance = parseFloat(value) || 0;
        emitUpdate();
      } else if (key === "NetLiquidation" && currency === "BASE") {
        const parsed = parseFloat(value);
        netLiquidation = Number.isFinite(parsed) ? parsed : null;
        emitUpdate();
      } else {
        debugLog("accountValue", `ignored key=${key} currency=${currency}`);
      }
    };

    const onAccountDownloadEnd = (accountName: string) => {
      debugLog("accountDownloadEnd", `received account=${accountName}`);
      if (accountName !== this.accountId && this.accountId) {
        debugLog("accountDownloadEnd", `ignored account mismatch expected=${this.accountId} got=${accountName}`);
        return;
      }
      initialLoadComplete = true;
      emitUpdate();
    };

    api.on(EventName.updatePortfolio, onPortfolioUpdate);
    api.on(EventName.pnl, onPnL);
    api.on(EventName.pnlSingle, onPnLSingle);
    api.on(EventName.updateAccountValue, onAccountValue);
    api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);

    debugLog("subscription", `reqAccountUpdates start account=${this.accountId}`);
    api.reqAccountUpdates(true, this.accountId);
    debugLog("subscription", `reqPnL start reqId=${pnlReqId} account=${this.accountId}`);
    api.reqPnL(pnlReqId, this.accountId, "");

    return () => {
      api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
      api.removeListener(EventName.pnl, onPnL);
      api.removeListener(EventName.pnlSingle, onPnLSingle);
      api.removeListener(EventName.updateAccountValue, onAccountValue);
      api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);

      debugLog("subscription", `reqAccountUpdates stop account=${this.accountId}`);
      api.reqAccountUpdates(false, this.accountId);
      debugLog("subscription", `cancelPnL reqId=${pnlReqId}`);
      api.cancelPnL(pnlReqId);

      for (const reqId of pnlSingleReqIds.values()) {
        debugLog("subscription", `cancelPnLSingle reqId=${reqId}`);
        api.cancelPnLSingle(reqId);
      }
      debugLog("subscribe", "portfolio stop");
    };
  }
}
