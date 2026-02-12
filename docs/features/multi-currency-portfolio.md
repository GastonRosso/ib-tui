# Multi-Currency Portfolio

Portfolio valuation supports assets and cash in mixed currencies, while keeping totals consistent and readable.

Core capabilities:
- Track each position in its native currency (for price/avg-cost context).
- Convert position and cash market value into account base currency for portfolio totals.
- Let users express the entire portfolio in a selected display currency.
- Surface pending FX conversions explicitly when rates are missing.

## User Experience

### Status line

The portfolio header includes currency context:
- `Base: <CCY>` is the account base currency detected from IBKR account values.
- `Display: <CCY>` appears when display currency differs from base.
- `N position(s) pending FX` appears when one or more non-base positions have no conversion rate yet.

### Keyboard controls

In the TUI:
- `]` cycles to the next display currency.
- `[` cycles to the previous display currency.

These controls are active from the main app view.

### Startup option

Set initial display currency via CLI:

```bash
npm run dev -- --portfolio-currency=EUR
```

Accepted values:
- `BASE`
- Any 3-letter currency code (for example `USD`, `EUR`, `JPY`)

Invalid values fail fast with a startup error.

## Rendering Rules

### Position row

- `CCY` column shows the position's native currency.
- Non-base currencies are highlighted.
- `Price` and `Avg Cost` are rendered in native position currency.
- `Unrealized` and `Mkt Value` are rendered in display currency.
- If FX is missing for a non-base position, market value shows `pending`.

### Cash section

- Cash rows are grouped by currency.
- `Mkt Value` is rendered in display currency.
- `FX Rate` shows conversion used for non-base rows (`n/a` when unavailable).

### Totals

Totals use display currency:
- `Pos Tot`
- `Cash Tot`
- `Tot`

## Conversion Model

### Base currency as source of truth

Internal portfolio totals are maintained in base currency:
- `positionsMarketValue`
- `positionsUnrealizedPnL`
- `cashBalance`
- `totalEquity`

Display currency is a view transform applied at render time:
- `displayValue = baseValue * displayFxRate`
- `displayFxRate = 1 / exchangeRates[displayCurrency]` for non-base display currencies
- `displayFxRate = 1` for base display currency

### Position-level conversion fields

`Position` includes:
- `marketValueBase: number | null`
- `unrealizedPnLBase: number | null`
- `fxRateToBase: number | null`
- `isFxPending: boolean`

This keeps conversion status explicit and testable.

## FX Rate Sources and Precedence

FX rates for non-base currencies are sourced from:
- `updateAccountValue(key="ExchangeRate")` (static/account feed)
- Live FX market data (`reqMktData`) for `CASH` pairs on `IDEALPRO`

Live stream details:
- One FX subscription per observed non-base currency (deduplicated across cash and positions)
- Rates are derived from `tickPrice` with this priority:
1. Mark/delayed mark tick values (`37`, `79`) when mark updates arrive
2. Bid/ask midpoint for bid/ask tick updates (`1`, `2`, `66`, `67`)
3. Last/delayed last (`4`, `68`) as fallback

Dedup behavior:
- Repeated identical rates are not re-emitted.
- Freshness timestamps still update on unchanged rates to avoid false stale recovery.

## Delayed Market Data Fallback

When live entitlements are unavailable, FX ticks can stall at `reqMktData` time.  
To avoid this, FX subscription setup requests delayed market data mode once:
- `reqMarketDataType(3)`

This enables delayed FX ticks when real-time ticks are not available.

## Resilience and Watchdog

A watchdog runs every 5 seconds and monitors:
- Contract details requests that stall.
- FX subscriptions with:
  - no ticks,
  - ticks but no usable rate,
  - stale rates.

For stale FX rates, the subscription is cancelled and re-requested.

Relevant timing constants:
- Initial/no-tick warning: 20s
- No-rate warning after ticks: 20s
- Stale-rate recovery threshold: 60s
- Watchdog interval: 5s

## Store and Preference Resolution

Display currency state in store:
- `displayCurrencyPreference`
- `displayCurrencyCode`
- `displayFxRate`
- `availableDisplayCurrencies`
- `displayCurrencyWarning`

Available display currencies are derived from:
- Base currency
- Position currencies
- Cash balance currencies

If preferred display currency lacks a usable rate, store falls back to base and surfaces:
- `Display currency <CCY> is not available, showing <BASE>`

## Environment Controls

- `IBKR_DISABLE_LIVE_FX=1` disables live FX subscriptions (static `ExchangeRate` only).

## Logging and Troubleshooting

Use debug logging:

```bash
npm run dev -- --log-file=logs/ibkr.log --log-level=debug
```

For FX diagnostics, focus on:
- `subscription.fx`
- `event.tickPrice.fx`
- `event.fxRate`
- `watchdog.fx`
- `state.snapshot`

Typical failure signal:
- `subscription.fx: reqMktData start ...` appears
- no `event.tickPrice.fx` lines afterward
- repeated `watchdog.fx: no ticks ...`

This indicates upstream market-data delivery is missing or stalled.

## Main Files

| File | Role |
|------|------|
| `src/broker/ibkr/portfolio/portfolioProjection.ts` | Base-currency projection and position/cash conversion |
| `src/broker/ibkr/portfolio/createPortfolioSubscription.ts` | IB event orchestration, FX subscriptions, watchdog/recovery |
| `src/state/store.ts` | Display currency preference, resolution, and fallback |
| `src/tui/PortfolioView.tsx` | Currency-aware rendering (rows, cash, totals, status) |
| `src/config/cliArgs.ts` | `--portfolio-currency` parsing/validation |
| `src/tui/App.tsx` | `[` / `]` display-currency keybindings |

## Test Coverage

Key tests:
- `src/broker/ibkr/portfolio/portfolioProjection.test.ts`
- `src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`
- `src/state/store.test.ts`
- `src/tui/PortfolioView.test.tsx`
- `src/config/cliArgs.test.ts`

They cover:
- Position and cash conversion behavior
- Display currency selection/cycling/fallback
- FX live/static interaction and delayed mark handling
- Currency-aware rendering and totals consistency
