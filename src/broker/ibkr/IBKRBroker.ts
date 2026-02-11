import { IBApi, EventName } from "@stoqey/ib";
import type {
  Broker,
  ConnectionConfig,
  AccountSummary,
  Position,
  Order,
  Quote,
  PortfolioUpdate,
  BrokerStatus,
  BrokerStatusLevel,
} from "../types.js";
import { log, isLogLevelEnabled } from "../../utils/logger.js";
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
  private statusCallbacks: Set<(status: BrokerStatus) => void> = new Set();

  private emitStatus(status: Omit<BrokerStatus, "at"> & { at?: number }): void {
    const payload: BrokerStatus = {
      at: status.at ?? Date.now(),
      level: status.level,
      message: status.message,
      code: status.code,
      reqId: status.reqId,
    };
    this.statusCallbacks.forEach((callback) => callback(payload));
  }

  private classifyInfoStatusLevel(code: number, message: string): BrokerStatusLevel | null {
    const errorCodes = new Set([1100, 1300, 2103, 2105, 2110, 2157]);
    const warnCodes = new Set([2107, 2108]);
    const infoCodes = new Set([1101, 1102, 2104, 2106, 2158]);

    if (errorCodes.has(code)) return "error";
    if (warnCodes.has(code)) return "warn";
    if (infoCodes.has(code)) return "info";

    const normalized = message.toLowerCase();
    if (normalized.includes("broken") || normalized.includes("disconnected")) return "error";
    if (normalized.includes("inactive")) return "warn";
    if (normalized.includes("restored") || normalized.includes("is ok")) return "info";
    return null;
  }

  private setupEventHandlers(): void {
    if (!this.api) return;
    const wireLogEnabled = isLogLevelEnabled("debug");

    this.api.on(EventName.connected, () => {
      log("debug", "event.connected", "received");
      this.connected = true;
      this.emitStatus({ level: "info", message: "Connected to IBKR" });
    });

    this.api.on(EventName.disconnected, () => {
      log("debug", "event.disconnected", "received");
      this.connected = false;
      this.emitStatus({ level: "error", message: "Disconnected from IBKR" });
      this.disconnectCallbacks.forEach((cb) => cb());
    });

    this.api.on(EventName.nextValidId, (orderId: number) => {
      log("debug", "event.nextValidId", `orderId=${orderId}`);
      this.nextOrderId = orderId;
    });

    this.api.on(EventName.error, (err: Error, code: number, reqId: number) => {
      log("error", "error", `code=${code} reqId=${reqId} message=${err.message}`);
      this.emitStatus({
        level: this.classifyInfoStatusLevel(code, err.message) ?? "error",
        message: err.message,
        code,
        reqId,
      });
      console.error(`IBKR Error [${code}] reqId=${reqId}:`, err.message);
    });

    this.api.on(EventName.info, (message: string, code: number) => {
      log("debug", "event.info", `code=${code} message=${message}`);
      const level = this.classifyInfoStatusLevel(code, message);
      if (level) {
        this.emitStatus({ level, message, code });
      }
    });

    this.api.on(EventName.managedAccounts, (accountsList: string) => {
      const accounts = accountsList.split(",");
      if (accounts.length > 0) {
        this.accountId = accounts[0];
      }
      log("debug", "event.managedAccounts", `accounts=${accountsList} selectedAccount=${this.accountId}`);
    });

    if (wireLogEnabled) {
      this.api.on(EventName.all, (eventName: string, args: unknown[]) => {
        if (eventName !== EventName.sent && eventName !== EventName.received) return;
        const tokens = Array.isArray(args[0]) ? args[0] : [];
        const head = tokens.slice(0, 8).map((token) => String(token)).join(",");
        const stream = eventName === EventName.sent ? "wire.sent" : "wire.received";
        log("debug", stream, `count=${tokens.length} head=${head}`);
      });

      log("debug", "wire", "verbose wire logging enabled");
    }
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

  onStatus(callback: (status: BrokerStatus) => void): () => void {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
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
