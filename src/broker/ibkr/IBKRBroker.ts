import { IBApi, EventName } from "@stoqey/ib";
import type {
  Broker,
  ConnectionConfig,
  AccountSummary,
  Position,
  Order,
  Quote,
  PortfolioUpdate,
} from "../types.js";
import { log } from "../../utils/logger.js";
import { createPortfolioSubscription } from "./portfolio/createPortfolioSubscription.js";

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
    const api = new IBApi({
      host: config.host,
      port: config.port,
    });
    this.api = api;
    this.setupEventHandlers();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
      }, 10000);

      api.once(EventName.nextValidId, () => {
        clearTimeout(timeout);
        resolve();
      });

      api.connect(config.clientId);
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
    return createPortfolioSubscription({
      api: this.api,
      accountId: () => this.accountId,
      callback,
      log,
    });
  }
}
