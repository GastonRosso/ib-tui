export type ConnectionConfig = {
  host: string;
  port: number;
  clientId: number;
};

export type Position = {
  symbol: string;
  quantity: number;
  avgCost: number;
  marketValue: number;
  unrealizedPnL: number;
  dailyPnL: number;
  realizedPnL: number;
  marketPrice: number;
  currency: string;
  conId: number;
};

export type AccountSummary = {
  accountId: string;
  netLiquidation: number;
  totalCashValue: number;
  buyingPower: number;
  positions: Position[];
};

export type Order = {
  id: number;
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: "MKT" | "LMT" | "STP" | "STP_LMT";
  limitPrice?: number;
  stopPrice?: number;
  status: OrderStatus;
};

export type OrderStatus =
  | "PendingSubmit"
  | "PreSubmitted"
  | "Submitted"
  | "Filled"
  | "Cancelled"
  | "ApiCancelled";

export type Quote = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
};

export type PortfolioUpdate = {
  positions: Position[];
  positionsMarketValue: number;
  totalEquity: number;
  accountDailyPnL: number;
  cashBalance: number;
  initialLoadComplete: boolean;
  positionPnlReady: boolean;
  accountPnlReady: boolean;
};

export type Broker = {
  connect(config?: ConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  onDisconnect(callback: () => void): () => void;

  getAccountSummary(): Promise<AccountSummary>;
  getPositions(): Promise<Position[]>;

  placeOrder(order: Omit<Order, "id" | "status">): Promise<Order>;
  cancelOrder(orderId: number): Promise<void>;
  getOpenOrders(): Promise<Order[]>;

  subscribeQuote(symbol: string, callback: (quote: Quote) => void): () => void;
  subscribePortfolio(callback: (update: PortfolioUpdate) => void): () => void;
};
