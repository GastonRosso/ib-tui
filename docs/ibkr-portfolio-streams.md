# IBKR Portfolio Streams (Account-Updates-Only Model)

This document describes the Interactive Brokers streams consumed by the app for portfolio rendering.

Scope:
- Runtime path: `subscribePortfolio()` in `src/broker/ibkr/IBKRBroker.ts`
- Store path: `src/state/store.ts`
- UI consumer: `src/tui/PortfolioView.tsx`
- Logger module: `src/utils/logger.ts`

## 1) Subscription

When `subscribePortfolio()` starts, the broker opens one IBKR subscription:

1. `reqAccountUpdates(true, accountId)`

On unsubscribe:

1. `reqAccountUpdates(false, accountId)`

No other subscriptions (`reqPnL`, `reqPnLSingle`) are used in this simplified model.

## 2) Events Consumed and Fields Used

### `updatePortfolio` (from `reqAccountUpdates`)

Consumed event payload:
- `contract.conId` (required key)
- `contract.symbol`
- `contract.currency`
- `pos`
- `marketPrice`
- `marketValue`
- `avgCost`
- `unrealizedPnL` (optional)
- `realizedPnL` (optional)
- `accountName` (filtered by selected account)

Used for:
- Position identity and lifecycle (create/update/remove)
- Position static metadata (`symbol`, `currency`, `avgCost`)
- Position size and valuation (`quantity`, `marketPrice`, `marketValue`)
- Unrealized and realized PnL

Important:
- This stream is the sole source for all position data.
- If `pos === 0`, the position is removed.

### `updateAccountValue` (from `reqAccountUpdates`)

Consumed event payload:
- `key`
- `value`
- `currency`
- `accountName`

Used for:
- Cash balance when `key === "TotalCashBalance"` and `currency === "BASE"`.

### `accountDownloadEnd` (from `reqAccountUpdates`)

Used for:
- Setting `initialLoadComplete = true`.
- UI only renders the portfolio table after this flag is true.

## 3) Data Ownership (Single Source of Truth)

1. `updatePortfolio` owns:
   - `quantity`
   - `marketPrice`
   - `marketValue`
   - `unrealizedPnL`
   - `realizedPnL`
   - static position metadata
   - `positionsMarketValue` (sum of all position market values)
2. `updateAccountValue` owns:
   - `cashBalance` (TotalCashBalance, BASE)

Total equity computation:
- `totalEquity = positionsMarketValue + cashBalance`

## 4) Why This Model

The previous multi-stream model (`reqPnL`, `reqPnLSingle`, `reqAccountUpdates`) created:
- Cross-stream timing drift (startup flash, periodic snap-back)
- Complex merge logic with realtime overlay and staleness windows
- Non-deterministic overwrites when stream timing changed

The account-updates-only model:
- Has a single deterministic data path
- No merge conflicts possible
- Simpler to debug and reason about

Tradeoff: lower update cadence (event-driven, often minutes between updates in quiet markets) vs. near-1s updates from `pnlSingle`.

## 5) Recency and Staleness

- `lastPortfolioUpdateAt` (epoch ms) is set on every broker event that triggers an emit.
- UI displays "Updated X ago" label that increments every second.
- Data is marked as stale (yellow) when no update has arrived for 3 minutes (180 seconds).

## 6) Readiness

- `initialLoadComplete` - set on `accountDownloadEnd`. UI shows "Loading full portfolio..." until this is true.
- No PnL readiness gates (removed with `reqPnL`/`reqPnLSingle`).

## 7) Logging

Enabled via `--log-file` CLI flag:
```bash
npm run dev -- --log-file=logs/ibkr.log --log-level=debug
```

When enabled, log entries are written to file only (never to terminal). Format: `[HH:MM:SS.mmm] LEVEL stream: detail`.

Broker event streams use `event.*` naming:
- `event.updatePortfolio`: conId, symbol, qty, mktPrice, mktValue
- `event.accountValue`: TotalCashBalance updates
- `event.accountDownloadEnd`: account name
- `event.emit`: summary (positionsMV, cash, totalEquity)

Levels: `error`, `warn`, `info`, `debug`. Default: `info`. Broker events log at `debug` level.

See `docs/features/logs.md` for full logging documentation.

## 8) Future Options

1. **Real-time market data via `reqMktData`**: Can be reintroduced for near-1s valuation updates per position. This would enable chart rendering and smoother value movement.
2. **Day P&L via `reqPnL`/`reqPnLSingle`**: Can be re-added for Day P&L columns in the table. These were removed to simplify the dashboard.
