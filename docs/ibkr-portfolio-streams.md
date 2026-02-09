# IBKR Portfolio Streams (Detailed)

This document describes every Interactive Brokers stream currently consumed by the app for portfolio rendering, what fields we extract from each stream, and how they are merged.

Scope:
- Runtime path: `subscribePortfolio()` in `src/broker/ibkr/IBKRBroker.ts`
- Store path: `src/state/store.ts`
- UI consumers: `src/tui/PortfolioView.tsx` and `src/tui/MarketValueChart.tsx`
- Debug module: `src/broker/ibkr/debug.ts`

## 1) Subscriptions Started

When `subscribePortfolio()` starts, the broker opens these IBKR subscriptions:

1. `reqAccountUpdates(true, accountId)`
2. `reqPnL(pnlReqId, accountId, "")`
3. `reqPnLSingle(reqId, accountId, "", conId)` for each active position discovered from `updatePortfolio`

On unsubscribe, the broker removes listeners and cancels:

1. `reqAccountUpdates(false, accountId)`
2. `cancelPnL(pnlReqId)`
3. `cancelPnLSingle(reqId)` for all requested per-position streams

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
- `unrealizedPnL` (optional fallback)
- `realizedPnL` (optional fallback)
- `accountName` (filtered by selected account)

Used for:
- Position identity and lifecycle (create/update/remove)
- Position static metadata (`symbol`, `currency`, `avgCost`)
- Position size and valuation (`quantity`, `marketPrice`, `marketValue`)

Important:
- This stream is the canonical source for `quantity`, `marketPrice`, and `marketValue`.
- If `pos === 0`, the position is removed and its `reqPnLSingle` is cancelled.

### `pnl` (from `reqPnL`)

Consumed event payload:
- `reqId` (must match account-level `pnlReqId`)
- `dailyPnL`

Used for:
- Account-level daily PnL (`accountDailyPnL`) shown in totals.
- Sets `pnlReady = true` on first tick.

### `pnlSingle` (from `reqPnLSingle`)

Consumed event payload:
- `reqId` (mapped back to `conId`)
- `dailyPnL`
- `unrealizedPnL` (optional)
- `realizedPnL` (optional)
- `pos`, `value` are currently ignored for valuation fields

Used for:
- Per-position intraday PnL fields:
  - `dailyPnL`
  - `unrealizedPnL`
  - `realizedPnL`

Important:
- `pnlSingle` is not used for `marketValue` or `marketPrice` to avoid cross-stream valuation drift.

### `updateAccountValue` (from `reqAccountUpdates`)

Consumed event payload:
- `key`
- `value`
- `currency`
- `accountName`

Used for:
- Cash balance when `key === "TotalCashBalance"` and `currency === "BASE"`.
- Net liquidation value when `key === "NetLiquidation"` and `currency === "BASE"`.

### `accountDownloadEnd` (from `reqAccountUpdates`)

Used for:
- Setting `initialLoadComplete = true`.
- UI only renders the portfolio table after this flag is true.

## 3) Merge Contract (Single Source of Truth)

Current merge contract in broker:

1. `updatePortfolio` owns:
   - `quantity`
   - `marketPrice`
   - `marketValue`
   - static position metadata
   - `positionsMarketValue` (sum of all position market values)
2. `pnlSingle` owns:
   - `dailyPnL`
   - `unrealizedPnL`
   - `realizedPnL`
3. `pnl` owns:
   - `accountDailyPnL`
   - `pnlReady` flag
4. `updateAccountValue` owns:
   - `cashBalance` (TotalCashBalance, BASE)
   - `netLiquidation` (NetLiquidation, BASE)

Total equity computation:
- `totalEquity = netLiquidation` when available (preferred).
- `totalEquity = positionsMarketValue + cashBalance` as fallback.

## 4) Why This Contract Exists

Observed production symptom:
- Portfolio total briefly loads low, then rises.
- Later, total can drift back toward that same lower level.

Root cause class:
- Two streams (`updatePortfolio` and `pnlSingle`) were previously allowed to write the same valuation fields (`marketValue`, `marketPrice`), with dynamic precedence rules. This creates non-deterministic overwrites when stream timing/order changes.

Resolution:
- Remove overlapping ownership. Keep valuation fields on one stream (`updatePortfolio`) and keep per-position PnL on `pnlSingle`.
- Prefer `NetLiquidation` from IBKR for `totalEquity` to reduce drift from mixed stream timing.

## 5) Store and Chart Implications

Store behavior (`src/state/store.ts`):
- Receives merged broker updates including `totalEquity`.
- Samples chart history at ~1 second cadence.
- Uses `totalEquity` directly for chart points (already includes cash via NetLiquidation or fallback).
- Starts chart only after `initialLoadComplete`.

Chart behavior (`src/tui/MarketValueChart.tsx`):
- Plots delta from session baseline.
- Uses expanding-only scale bounds (hysteresis) for visual stability.

## 6) Readiness Gates

1. `initialLoadComplete` - set on `accountDownloadEnd`. UI renders portfolio table only after this.
2. `pnlReady` - set on first `pnl` tick. Day P&L shows `--` placeholder until ready (avoids misleading `$0.00`).

## 7) Debug Logging

Enabled via `--debug-streams` CLI flag:
```bash
npm run dev -- --debug-streams
```

When enabled, compact per-event logs are written to stderr with timestamps:
- `updatePortfolio`: conId, symbol, qty, mktPrice, mktValue
- `pnlSingle`: conId, dailyPnL, unrealizedPnL, realizedPnL, value
- `pnl`: accountDailyPnL
- `accountValue`: TotalCashBalance and NetLiquidation updates
- `accountDownloadEnd`: account name
- `emit`: merge summary (positionsMarketValue, cashBalance, netLiquidation, totalEquity)

Default run has no extra logs.

## 8) Remaining Known Behaviors

1. Position valuation update cadence is tied to `updatePortfolio`.
- `pnlSingle` no longer drives valuation.
- If `updatePortfolio` cadence is slower than expected for a symbol, valuation movement can appear less frequent.

2. `NetLiquidation` may be missing or delayed on some accounts.
- Fallback computation (`positionsMarketValue + cashBalance`) is used automatically.
