# Multi-Currency Portfolio Support

## Overview

The app supports portfolios containing assets across multiple currencies. Each position retains its local-currency values from IBKR while the projection layer converts market value and PnL to the account's base currency using FX rates. The UI highlights non-base currency assets and supports a runtime display-currency switcher.

## How It Works

### Position FX Conversion

Each `Position` carries base-currency fields computed by the projection layer:

- `marketValueBase` — local `marketValue * fxRate`, or `null` if FX is pending.
- `unrealizedPnLBase` — local `unrealizedPnL * fxRate`, or `null` if FX is pending.
- `fxRateToBase` — the FX rate used (currency → base), `1` for base-currency positions, `null` if pending.
- `isFxPending` — `true` when no FX rate is available for this position's currency.

### Aggregation Rules

- `positionsMarketValue` is the sum of all non-null `marketValueBase` values (base-currency denominated).
- `positionsUnrealizedPnL` is the sum of all non-null `unrealizedPnLBase` values.
- Positions with pending FX are **excluded** from converted totals.
- `positionsPendingFxCount` and `positionsPendingFxByCurrency` track how many positions are pending and their local-currency notional.

### FX Rate Sources

FX rates are sourced in order of precedence:

1. **Live FX** from `reqMktData` on IDEALPRO CASH pairs (bid/ask midpoint, or mark, or last).
2. **Static `ExchangeRate`** from `updateAccountValue` events (used until live FX supersedes).

Subscriptions are triggered for any non-base currency observed in either cash balances or position currencies, deduplicated by currency.

### Pending FX Behavior

When a non-base position arrives before its FX rate:

1. The position is marked `isFxPending = true`.
2. Its `marketValueBase` and `unrealizedPnLBase` are `null`.
3. It is excluded from `positionsMarketValue` totals.
4. The UI shows "pending" in the Mkt Value column and blanks the % Port column.
5. Once the FX rate arrives, the position is immediately converted and included in totals.

## Display Currency

### Available Currencies

The list of available display currencies is derived dynamically from:
- The account's base currency.
- Currencies of all open positions.
- Currencies of all cash balances.

### Setting Display Currency

**At startup:**
```bash
npm run dev -- --portfolio-currency=EUR
npm run dev -- --portfolio-currency=BASE   # explicit base currency
```

**At runtime:**
- `]` — cycle to next display currency
- `[` — cycle to previous display currency

### Fallback Behavior

If the selected display currency is not currently convertible (FX rate not available), the UI falls back to the account's base currency and shows a warning message.

## UI Changes

### Position Table

- New **CCY** column showing each position's local currency.
- Non-base currency codes are highlighted in yellow.
- **Mkt Value** shows the base-converted value, or "pending" if FX is unavailable.
- **% Port** is blank for pending positions.

### Currency Status Line

Below the Portfolio header, a status line shows:
- **Base: USD** — the account's base currency.
- **Display: EUR** — shown when display currency differs from base.
- **N positions pending FX** — shown when positions are awaiting FX rates.

### Warning Line

When a preferred display currency cannot be resolved, a yellow warning line appears:
> Display currency EUR is not available, showing USD

## CLI Reference

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--portfolio-currency=<CODE>` | `BASE`, any 3-letter currency code | `BASE` | Set initial display currency preference |

## Keyboard Reference

| Key | Action |
|-----|--------|
| `]` | Next display currency |
| `[` | Previous display currency |
