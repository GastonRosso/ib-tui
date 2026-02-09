# Architecture

TUI application for Interactive Brokers built with TypeScript, Ink (React for CLI), and Zustand.

## Project Structure

```
src/
├── index.ts              # Entry point - renders App component
├── broker/               # Broker abstraction layer
│   ├── types.ts          # Interfaces and types
│   └── ibkr/
│       └── IBKRBroker.ts # IBKR implementation
├── utils/
│   └── logger.ts         # File-only logger with level filtering
├── state/
│   └── store.ts          # Zustand state management
└── tui/
    ├── App.tsx           # Root component, keyboard handling
    └── PortfolioView.tsx # Portfolio table
```

## Layers

### 1. Broker Abstraction (`src/broker/`)

The `Broker` interface defines all broker interactions:

```typescript
type Broker = {
  connect(config?: ConnectionConfig): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
  onDisconnect(callback: () => void): () => void

  getAccountSummary(): Promise<AccountSummary>
  getPositions(): Promise<Position[]>

  placeOrder(order: Omit<Order, "id" | "status">): Promise<Order>
  cancelOrder(orderId: number): Promise<void>
  getOpenOrders(): Promise<Order[]>

  subscribeQuote(symbol: string, callback: (quote: Quote) => void): () => void
  subscribePortfolio(callback: (update: PortfolioUpdate) => void): () => void
}
```

This abstraction allows swapping IBKR for other brokers or mocks without touching UI or state code.

### 2. IBKR Implementation (`src/broker/ibkr/IBKRBroker.ts`)

Uses `@stoqey/ib` library to communicate with TWS/IB Gateway via socket API.

**Connection:**
- Connects to `IBKR_HOST:IBKR_PORT` (defaults: `127.0.0.1:4001`)
- Waits for `nextValidId` event to confirm connection
- Captures `accountId` from `managedAccounts` event

**Portfolio Subscription (Account-Updates-Only Model):**

The `subscribePortfolio()` method uses a single IBKR subscription:

| API Call | Event | Data | Update Frequency |
|----------|-------|------|------------------|
| `reqAccountUpdates` | `updatePortfolio` | symbol, avgCost, currency, conId, quantity, marketPrice, marketValue | On portfolio/account updates |
| `reqAccountUpdates` | `updateAccountValue` | cashBalance (`TotalCashBalance`, `BASE`) | On changes |
| `reqAccountUpdates` | `accountDownloadEnd` | initial load complete flag | End of initial snapshot |

Single source of truth: `updatePortfolio` owns position data and valuation, `updateAccountValue` owns cash balance, `accountDownloadEnd` owns initial load completion.

**Cadence:**
- Updates are event-driven, typically arriving on portfolio changes rather than at a fixed interval.
- This is slower than the previous multi-stream model (~1s from `pnlSingle`) but eliminates cross-stream drift and merge complexity.

### 3. State Management (`src/state/store.ts`)

Zustand store with single broker instance:

```typescript
type AppState = {
  broker: Broker
  connectionStatus: "disconnected" | "connecting" | "connected" | "error"
  error: string | null

  positions: Position[]
  positionsMarketValue: number
  totalEquity: number
  cashBalance: number
  initialLoadComplete: boolean
  lastPortfolioUpdateAt: number | null

  connect: () => Promise<void>
  disconnect: () => Promise<void>
  subscribePortfolio: () => () => void
}
```

The store bridges broker events to React components. When `subscribePortfolio()` callback fires, it updates state, triggering component re-renders.

### 4. TUI Components (`src/tui/`)

**App.tsx** - Root component:
- Keyboard handling: `c` to connect, `q` to quit
- Status indicator (green/yellow/red)
- Renders `PortfolioView` when connected

**PortfolioView.tsx** - Portfolio display:
- Subscribes to portfolio updates on mount
- Fixed-width column table layout
- Color-coded unrealized P&L (green positive, red negative)
- Shows positions, cash, and totals
- Recency indicator ("Updated X ago") with stale detection at 3 minutes

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  TWS / IB Gateway                           │
│                  (Port 4001/4002)                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ Socket API
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    IBKRBroker                               │
│                                                             │
│  Subscription:                                              │
│  └─ reqAccountUpdates → updatePortfolio (positions + values)│
│                       → updateAccountValue (cash balance)   │
│                       → accountDownloadEnd (load complete)  │
│                                                             │
│  Consolidates into PortfolioUpdate callback                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ callback(PortfolioUpdate)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zustand Store                            │
│                                                             │
│  Updates: positions, positionsMarketValue,                  │
│           totalEquity, cashBalance, lastPortfolioUpdateAt   │
└─────────────────────────┬───────────────────────────────────┘
                          │ State change triggers re-render
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    React/Ink Components                     │
│                                                             │
│  App.tsx → PortfolioView.tsx                                │
│  useStore() reads latest state                              │
│  Renders portfolio table to terminal                        │
└─────────────────────────────────────────────────────────────┘
```

## Key Types

**Position:**
```typescript
type Position = {
  symbol: string
  quantity: number
  avgCost: number
  marketValue: number
  unrealizedPnL: number
  dailyPnL: number
  realizedPnL: number
  marketPrice: number
  currency: string
  conId: number
}
```

**PortfolioUpdate:**
```typescript
type PortfolioUpdate = {
  positions: Position[]
  positionsMarketValue: number
  totalEquity: number
  cashBalance: number
  initialLoadComplete: boolean
  lastPortfolioUpdateAt: number
}
```

## Configuration

CLI flags:
- `--log-file[=<path>]` - Enable file logging (default path: `logs/ibkr.log`)
- `--log-level=<error|warn|info|debug>` - Minimum log severity (default: `info`)

Environment variables:
- `IBKR_HOST` - Gateway host (default: `127.0.0.1`)
- `IBKR_PORT` - Gateway port (default: `4001`)

Common ports:
- `7496` - TWS live
- `7497` - TWS paper
- `4001` - Gateway live
- `4002` - Gateway paper

## Future Options

- **Real-time market data**: `reqMktData` can be reintroduced for near-1s valuation updates per position. This would restore chart capability and smoother value movement at the cost of additional stream complexity.
- **Day P&L**: Account-level `reqPnL` and per-position `reqPnLSingle` can be re-added if Day P&L columns are needed. These were removed to simplify the dashboard.
