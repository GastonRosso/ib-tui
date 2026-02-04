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

**Portfolio Subscription:**

The `subscribePortfolio()` method combines multiple IBKR data streams:

| API Call | Event | Data | Update Frequency |
|----------|-------|------|------------------|
| `reqAccountUpdates` | `updatePortfolio` | symbol, avgCost, currency, conId | On significant changes |
| `reqPnL` | `pnl` | accountDailyPnL | Every second |
| `reqPnLSingle` | `pnlSingle` | dailyPnL, unrealizedPnL, marketValue, marketPrice | Every second |
| `reqAccountUpdates` | `updateAccountValue` | cashBalance | On changes |

Key insight: `reqPnLSingle` provides real-time streaming for most fields. We use `updatePortfolio` only for static data (symbol, avgCost, currency) and let `pnlSingle` drive all real-time updates.

**Position Data Merge Logic:**

```
1. updatePortfolio fires → creates position with static data
2. reqPnLSingle(conId) starts for each position
3. pnlSingle fires every second → updates:
   - marketValue (from value)
   - marketPrice (calculated: value / pos)
   - unrealizedPnL
   - dailyPnL
   - realizedPnL
4. If updatePortfolio fires again → preserves existing real-time data
```

### 3. State Management (`src/state/store.ts`)

Zustand store with single broker instance:

```typescript
type AppState = {
  broker: Broker
  connectionStatus: "disconnected" | "connecting" | "connected" | "error"
  error: string | null

  positions: Position[]
  totalPortfolioValue: number
  accountDailyPnL: number
  cashBalance: number

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
- Color-coded P&L (green positive, red negative)
- Shows positions, cash, and totals

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
│  Subscriptions:                                             │
│  ├─ reqAccountUpdates → updatePortfolio (static data)       │
│  ├─ reqPnL → pnl (account daily P&L)                        │
│  ├─ reqPnLSingle → pnlSingle (real-time position data)      │
│  └─ updateAccountValue (cash balance)                       │
│                                                             │
│  Consolidates into PortfolioUpdate callback                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ callback(PortfolioUpdate)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zustand Store                            │
│                                                             │
│  Updates: positions, totalPortfolioValue,                   │
│           accountDailyPnL, cashBalance                      │
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
  totalPortfolioValue: number
  accountDailyPnL: number
  cashBalance: number
}
```

## Configuration

Environment variables:
- `IBKR_HOST` - Gateway host (default: `127.0.0.1`)
- `IBKR_PORT` - Gateway port (default: `4001`)

Common ports:
- `7496` - TWS live
- `7497` - TWS paper
- `4001` - Gateway live
- `4002` - Gateway paper
