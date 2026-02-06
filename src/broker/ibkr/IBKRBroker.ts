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
      this.connected = true;
    });

    this.api.on(EventName.disconnected, () => {
      this.connected = false;
      this.disconnectCallbacks.forEach((cb) => cb());
    });

    this.api.on(EventName.nextValidId, (orderId: number) => {
      this.nextOrderId = orderId;
    });

    this.api.on(EventName.error, (err: Error, code: number, reqId: number) => {
      console.error(`IBKR Error [${code}] reqId=${reqId}:`, err.message);
    });

    this.api.on(EventName.managedAccounts, (accountsList: string) => {
      const accounts = accountsList.split(",");
      if (accounts.length > 0) {
        this.accountId = accounts[0];
      }
    });
  }

  async connect(config: ConnectionConfig = DEFAULT_CONFIG): Promise<void> {
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
    let totalPortfolioValue = 0;
    let accountDailyPnL = 0;
    let cashBalance = 0;
    let initialLoadComplete = false;

    const pnlReqId = this.getNextReqId();
    const pnlSingleReqIds = new Map<number, number>();

    const emitUpdate = () => {
      callback({
        positions: Array.from(positions.values()),
        totalPortfolioValue,
        accountDailyPnL,
        cashBalance,
        initialLoadComplete,
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
      if (accountName !== this.accountId && this.accountId) return;

      // Guard against missing contract ids to avoid collapsing distinct positions
      if (contract.conId === undefined || contract.conId === null) return;
      const conId = contract.conId;
      const existing = positions.get(conId);

      const position: Position = {
        symbol: contract.symbol ?? "",
        quantity: pos,
        avgCost: avgCost ?? 0,
        marketValue,
        unrealizedPnL: unrealizedPnL ?? existing?.unrealizedPnL ?? 0,
        dailyPnL: existing?.dailyPnL ?? 0,
        realizedPnL: realizedPnL ?? existing?.realizedPnL ?? 0,
        marketPrice,
        currency: contract.currency ?? "USD",
        conId,
      };

      if (pos === 0) {
        positions.delete(conId);
        const reqId = pnlSingleReqIds.get(conId);
        if (reqId !== undefined) {
          api.cancelPnLSingle(reqId);
          pnlSingleReqIds.delete(conId);
        }
      } else {
        positions.set(conId, position);
        if (!pnlSingleReqIds.has(conId)) {
          const reqId = this.getNextReqId();
          pnlSingleReqIds.set(conId, reqId);
          api.reqPnLSingle(reqId, this.accountId, "", conId);
        }
      }

      totalPortfolioValue = Array.from(positions.values()).reduce(
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
      if (reqId === pnlReqId) {
        accountDailyPnL = dailyPnL;
        emitUpdate();
      }
    };

    const onPnLSingle = (
      reqId: number,
      _pos: number,
      dailyPnL: number,
      unrealizedPnL: number | undefined,
      realizedPnL: number | undefined,
      _value: number
    ) => {
      for (const [conId, rid] of pnlSingleReqIds.entries()) {
        if (rid === reqId) {
          const existing = positions.get(conId);
          if (existing) {
            // Use pnlSingle only for P&L fields. Price/value and size remain sourced from updatePortfolio.
            positions.set(conId, {
              ...existing,
              unrealizedPnL: unrealizedPnL ?? existing.unrealizedPnL,
              realizedPnL: realizedPnL ?? existing.realizedPnL,
              dailyPnL,
            });
          }
          emitUpdate();
          break;
        }
      }
    };

    const onAccountValue = (
      key: string,
      value: string,
      currency: string,
      accountName: string
    ) => {
      if (accountName !== this.accountId && this.accountId) return;
      if (key === "TotalCashBalance" && currency === "BASE") {
        cashBalance = parseFloat(value) || 0;
        emitUpdate();
      }
    };

    const onAccountDownloadEnd = (accountName: string) => {
      if (accountName !== this.accountId && this.accountId) return;
      initialLoadComplete = true;
      emitUpdate();
    };

    api.on(EventName.updatePortfolio, onPortfolioUpdate);
    api.on(EventName.pnl, onPnL);
    api.on(EventName.pnlSingle, onPnLSingle);
    api.on(EventName.updateAccountValue, onAccountValue);
    api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);

    api.reqAccountUpdates(true, this.accountId);
    api.reqPnL(pnlReqId, this.accountId, "");

    return () => {
      api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
      api.removeListener(EventName.pnl, onPnL);
      api.removeListener(EventName.pnlSingle, onPnLSingle);
      api.removeListener(EventName.updateAccountValue, onAccountValue);
      api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);

      api.reqAccountUpdates(false, this.accountId);
      api.cancelPnL(pnlReqId);

      for (const reqId of pnlSingleReqIds.values()) {
        api.cancelPnLSingle(reqId);
      }
    };
  }
}
