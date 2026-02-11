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

Additionally, the subscription layer requests live FX rates for non-base currencies:

1. `reqMktData(reqId, fxContract, ...)` — one per non-base currency observed in cash balances or position currencies (deduplicated).

On unsubscribe, all FX market data subscriptions are cancelled via `cancelMktData(reqId)`.

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
- Per-currency cash balances when `key === "TotalCashBalance"` and `currency !== "BASE"`.
- Base currency detection when `key === "TotalCashValue"` (the `currency` field identifies the account base currency).
- Static exchange rates when `key === "ExchangeRate"` (used as fallback until live FX supersedes).

### `accountDownloadEnd` (from `reqAccountUpdates`)

Used for:
- Setting `initialLoadComplete = true`.
- UI only renders the portfolio table after this flag is true.

### `tickPrice` (from `reqMktData` — FX subscriptions)

Consumed event payload:
- `reqId` (correlated to FX subscription)
- `field` (1=bid, 2=ask, 4=last, 37=mark)
- `value` (price)

Used for:
- Live FX rate updates for non-base currencies. The midpoint of bid/ask is preferred; mark and last are used as fallback.
- Rates are applied to the projection layer, which recomputes per-position base values and cash conversion.

### `contractDetails` / `contractDetailsEnd` (from `reqContractDetails`)

Consumed event payload:
- `contract.conId`
- `timeZoneId` (e.g. `"EST"`, `"America/New_York"`)
- `liquidHours` (e.g. `"20260210:0930-1600;20260211:0930-1600"`)
- `tradingHours` (e.g. `"20260210:0400-2000;20260211:0400-2000"`)

Used for:
- Enriching each position with `marketHours` metadata (timezone, liquid hours, trading hours).
- Requested once per conId on first portfolio update; cached and not re-requested.
- IB timezone abbreviations (EST, JST, etc.) are normalized to IANA identifiers before use.

## 3) Data Ownership (Single Source of Truth)

1. `updatePortfolio` owns:
   - `quantity`
   - `marketPrice`
   - `marketValue` (local currency)
   - `unrealizedPnL` (local currency)
   - `realizedPnL`
   - static position metadata (`symbol`, `currency`, `conId`)
2. `updateAccountValue` owns:
   - `cashBalance` (TotalCashBalance, BASE)
   - `cashBalancesByCurrency` (TotalCashBalance, per currency)
   - `baseCurrencyCode` (from TotalCashValue currency field)
   - `exchangeRatesByCurrency` (static ExchangeRate values, used until live FX supersedes)
3. `tickPrice` (FX subscriptions) owns:
   - Live FX rates per non-base currency
4. Projection layer derives:
   - `marketValueBase` — local `marketValue * fxRate`, or `null` if FX pending
   - `unrealizedPnLBase` — local `unrealizedPnL * fxRate`, or `null` if FX pending
   - `fxRateToBase` — FX rate used (1 for base-currency positions, null if pending)
   - `isFxPending` — true when no FX rate is available for the position's currency
   - `positionsMarketValue` — sum of non-null `marketValueBase` values (base-currency denominated)
   - `positionsUnrealizedPnL` — sum of non-null `unrealizedPnLBase` values
   - `positionsPendingFxCount` — count of positions awaiting FX rates
   - `positionsPendingFxByCurrency` — local-currency notional grouped by currency for pending positions

Total equity computation:
- `totalEquity = positionsMarketValue + cashBalance`
- Positions with pending FX are excluded from `positionsMarketValue`.

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
- `event.reqContractDetails`: reqId, conId, symbol (outgoing request)
- `event.contractDetails`: reqId, conId, timezone (incoming response)

State snapshots use `state.snapshot` (emitted by the store when broker updates are applied):
- `state.snapshot`: summary (positionsMV, cash, totalEquity)

Levels: `error`, `warn`, `info`, `debug`. Default: `info`. Broker events log at `debug` level.

See `docs/features/logs.md` for full logging documentation.

## 8) FX Rate Sources and Precedence

FX rates for converting non-base positions and cash to base currency are sourced in order:

1. **Live FX** from `reqMktData` on IDEALPRO CASH pairs (bid/ask midpoint, or mark, or last).
2. **Static `ExchangeRate`** from `updateAccountValue` events (used until live FX supersedes).

FX subscriptions are triggered for any non-base currency observed in cash balances or position currencies, deduplicated by currency. Subscriptions are established after `accountDownloadEnd` and base currency detection.

When a non-base position arrives before its FX rate:
1. The position is marked `isFxPending = true`.
2. Its `marketValueBase` and `unrealizedPnLBase` are `null`.
3. It is excluded from `positionsMarketValue` totals.
4. Once the FX rate arrives, the position is immediately converted and included in totals.

## 9) Future Options

1. **Real-time market data via `reqMktData`**: Can be reintroduced for near-1s valuation updates per position. This would enable chart rendering and smoother value movement.
2. **Day P&L via `reqPnL`/`reqPnLSingle`**: Can be re-added for Day P&L columns in the table. These were removed to simplify the dashboard.
