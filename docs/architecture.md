# Architecture

TUI application for Interactive Brokers built with TypeScript, Ink (React for CLI), and Zustand.

For a code-trace walkthrough of startup, broker creation, connection, and event propagation with Mermaid sequence diagrams and ordered `file:line` references, see [`docs/main-flow.md`](main-flow.md).

## Project Structure

```
src/
├── index.ts              # Entry point - renders App component
├── broker/               # Broker abstraction layer
│   ├── types.ts          # Interfaces and types
│   └── ibkr/
│       ├── index.ts      # Public barrel export (IBKRBroker)
│       ├── IBKRBroker.ts # Thin adapter implementing Broker interface
│       ├── market-hours/
│       │   ├── index.ts
│       │   ├── resolveMarketHours.ts  # Pure market hours calculator
│       │   └── resolveMarketHours.test.ts
│       └── portfolio/
│           ├── createPortfolioSubscription.ts  # Event wiring orchestration
│           ├── portfolioProjection.ts          # Pure portfolio state container
│           ├── contractDetailsTracker.ts       # Request dedup and correlation
│           └── types.ts
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

### 2. IBKR Implementation (`src/broker/ibkr/`)

`IBKRBroker` is a thin adapter that implements `Broker` and delegates subscription logic to focused modules under `src/broker/ibkr/portfolio/`. Uses `@stoqey/ib` library to communicate with TWS/IB Gateway via socket API.

**Connection:**
- Connects to `IBKR_HOST:IBKR_PORT` (defaults: `127.0.0.1:4001`)
- Waits for `nextValidId` event to confirm connection
- Captures `accountId` from `managedAccounts` event

**Portfolio Subscription (Account-Updates-Only Model):**

The `subscribePortfolio()` method uses a single IBKR subscription:

| API Call | Event | Data | Update Frequency |
|----------|-------|------|------------------|
| `reqAccountUpdates` | `updatePortfolio` | symbol, avgCost, currency, conId, quantity, marketPrice, marketValue | On portfolio/account updates |
| `reqAccountUpdates` | `updateAccountValue` | cashBalance (`TotalCashBalance`, `BASE`), per-currency balances, base currency, static FX rates | On changes |
| `reqAccountUpdates` | `accountDownloadEnd` | initial load complete flag | End of initial snapshot |
| `reqContractDetails` | `contractDetails` | timeZoneId, liquidHours, tradingHours | Once per conId |
| `reqMktData` | `tickPrice` | Live FX rates for non-base currencies (IDEALPRO CASH pairs) | On FX tick |

Single source of truth: `updatePortfolio` owns position data and local-currency valuation, `updateAccountValue` owns cash balance and base currency, `accountDownloadEnd` owns initial load completion. The projection layer converts local values to base currency using FX rates from live `reqMktData` subscriptions (with static `ExchangeRate` as fallback).

**Cadence:**
- Updates are event-driven, typically arriving on portfolio changes rather than at a fixed interval.
- This is slower than the previous multi-stream model (~1s from `pnlSingle`) but eliminates cross-stream drift and merge complexity.

**Market Hours (`src/broker/ibkr/market-hours/resolveMarketHours.ts`):**

Pure utility that determines whether a market is open or closed at a given time, using IB's `liquidHours`/`tradingHours` schedule strings and timezone metadata from `reqContractDetails`. Supports both legacy and TWS v970+ hour formats, normalizes 14 IB timezone abbreviations to IANA identifiers, and is fully deterministic (injectable `nowMs`). See [`docs/features/market-hours.md`](features/market-hours.md) for full documentation.

**Portfolio Modules (`src/broker/ibkr/portfolio/`):**

- `createPortfolioSubscription.ts` — orchestrates event wiring between the IB API and the projection/tracker modules.
- `portfolioProjection.ts` — pure state container that accumulates position updates, cash balance, FX rates, and market hours into a `PortfolioUpdate` snapshot. Converts per-position values to base currency and tracks pending FX state.
- `contractDetailsTracker.ts` — deduplicates `reqContractDetails` requests and correlates responses back to contract IDs.
- `types.ts` — adapter-boundary IB event types (`PortfolioApi`, `PortfolioEventMap`, `PortfolioContractSeed`, `ContractDetailsPayload`). Implementation-only types stay in file scope.

### 3. State Management (`src/state/store.ts`)

Zustand store with single broker instance:

```typescript
type AppState = {
  broker: Broker
  connectionStatus: "disconnected" | "connecting" | "connected" | "error"
  error: string | null

  positions: Position[]
  positionsMarketValue: number
  positionsUnrealizedPnL: number
  totalEquity: number
  cashBalance: number
  cashBalancesByCurrency: Record<string, number>
  cashExchangeRatesByCurrency: Record<string, number>
  baseCurrencyCode: string | null
  initialLoadComplete: boolean
  lastPortfolioUpdateAt: number | null
  positionsPendingFxCount: number
  positionsPendingFxByCurrency: Record<string, number>

  displayCurrencyPreference: "BASE" | string
  displayCurrencyCode: string | null
  availableDisplayCurrencies: string[]
  displayCurrencyWarning: string | null

  connect: () => Promise<void>
  disconnect: () => Promise<void>
  subscribePortfolio: () => () => void
  setDisplayCurrencyPreference: (preference: "BASE" | string) => void
  cycleDisplayCurrency: (direction: "next" | "prev") => void
}
```

The store bridges broker events to React components. When `subscribePortfolio()` callback fires, it updates state, triggering component re-renders.
The store also resolves display currency on each portfolio update (deriving available currencies from positions and cash, falling back to base with a warning if the preferred currency is not convertible).
The store emits `state.snapshot` debug logs after applying portfolio updates, including base currency, display currency, and pending FX counts.

UI components use selector-based Zustand subscriptions (`useStore((s) => s.field)`) to minimize re-renders.

**Shared primitives (`src/state/types.ts`):**
- `ConnectionStatus` — union of `"disconnected" | "connecting" | "connected" | "error"`, shared across store and UI.

### 4. TUI Components (`src/tui/`)

**App.tsx** - Root component:
- Keyboard handling: `c` to connect, `q` to quit, `[`/`]` to cycle display currency
- Status indicator (green/yellow/red)
- Renders `PortfolioView` when connected

**PortfolioView.tsx** - Portfolio display:
- Subscribes to portfolio updates on mount
- Fixed-width column table layout with CCY column showing each position's local currency
- Non-base currency codes highlighted in yellow
- Color-coded unrealized P&L (green positive, red negative)
- Per-position `Mkt Hrs` column: color-coded countdown (green=open, yellow=closed) to next session transition
- Shows positions, cash, and totals (base-currency converted)
- Positions with pending FX show "pending" for market value and blank % Port
- Currency status line showing base currency, display currency (if different), and pending FX count
- Warning line when display currency falls back to base
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
│  Subscriptions:                                             │
│  └─ reqAccountUpdates → updatePortfolio (positions + values)│
│                       → updateAccountValue (cash, FX, base) │
│                       → accountDownloadEnd (load complete)  │
│  └─ reqContractDetails → contractDetails (market hours)     │
│  └─ reqMktData (FX)   → tickPrice (live FX rates)          │
│                                                             │
│  Projection: converts local→base using FX, tracks pending   │
│  Consolidates into PortfolioUpdate callback                 │
└─────────────────────────┬───────────────────────────────────┘
                          │ callback(PortfolioUpdate)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Zustand Store                            │
│                                                             │
│  Updates: positions, positionsMarketValue,                  │
│           positionsUnrealizedPnL, totalEquity, cashBalance, │
│           baseCurrencyCode, displayCurrency, pendingFx,     │
│           lastPortfolioUpdateAt                             │
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
  marketValue: number           // local currency
  unrealizedPnL: number         // local currency
  dailyPnL: number
  realizedPnL: number
  marketPrice: number
  currency: string
  conId: number
  marketHours?: PositionMarketHours
  marketValueBase: number | null       // base currency (null if FX pending)
  unrealizedPnLBase: number | null     // base currency (null if FX pending)
  fxRateToBase: number | null          // FX rate used (1 for base, null if pending)
  isFxPending: boolean                 // true when FX rate not yet available
}
```

**PortfolioUpdate:**
```typescript
type PortfolioUpdate = {
  positions: Position[]
  positionsMarketValue: number              // sum of non-null marketValueBase
  positionsUnrealizedPnL: number            // sum of non-null unrealizedPnLBase
  totalEquity: number
  cashBalance: number
  cashBalancesByCurrency: Record<string, number>
  cashExchangeRatesByCurrency: Record<string, number>
  baseCurrencyCode: string | null
  initialLoadComplete: boolean
  lastPortfolioUpdateAt: number
  positionsPendingFxCount: number
  positionsPendingFxByCurrency: Record<string, number>
}
```

## Configuration

CLI flags:
- `--log-file[=<path>]` - Enable file logging (default path: `logs/ibkr.log`)
- `--log-level=<error|warn|info|debug>` - Minimum log severity (default: `info`)
- `--portfolio-currency=<BASE|CCC>` - Set initial display currency preference (default: `BASE`)

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
