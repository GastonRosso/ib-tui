# Multi-Currency Portfolio Support Implementation Plan

## Status
Planned on 2026-02-11.

## Goal
Support portfolios containing assets across multiple currencies by:
- preserving each asset's local currency values,
- converting market value and aggregate totals to base currency for valuation,
- clearly highlighting non-base assets in the UI,
- allowing users to express the whole portfolio in another display currency.

## Architecture Summary
The broker layer remains the source of local asset values from IBKR (`updatePortfolio`). The projection layer becomes responsible for converting local position values into base currency using FX rates, while retaining local values for display context. The store adds a display-currency preference and resolution logic. The TUI renders local currency metadata plus converted totals and supports runtime display-currency switching.

## Product Decisions (Locked)
- Runtime display-currency UX: keyboard cycle plus startup flag.
- Startup display-currency flag: `--portfolio-currency=<BASE|CCC>`.
- Runtime keybindings: `[` (previous currency), `]` (next currency).
- Missing position FX behavior: show pending and exclude that position from converted totals until FX is available.
- Display-currency options: account base currency plus currencies observed in portfolio positions and cash balances.

## Public Type and Contract Changes
Modify `/Users/gastonrosso/Projects/ib/src/broker/types.ts`.

### `Position` additions
- `marketValueBase: number | null`
- `unrealizedPnLBase: number | null`
- `fxRateToBase: number | null`
- `isFxPending: boolean`

### `PortfolioUpdate` additions
- `positionsUnrealizedPnL: number`
- `positionsPendingFxCount: number`
- `positionsPendingFxByCurrency: Record<string, number>`

## Conversion and Aggregation Rules
1. Keep `position.marketValue` and `position.unrealizedPnL` as local-currency values from IBKR.
2. Compute base values in projection:
- if `position.currency === baseCurrencyCode`: base value equals local value and FX rate is `1`.
- else if FX exists for the position currency: base value equals local value multiplied by FX rate.
- else: base value is `null` and `isFxPending=true`.
3. Aggregate with converted values only:
- `positionsMarketValue` is the sum of non-null `marketValueBase`.
- `positionsUnrealizedPnL` is the sum of non-null `unrealizedPnLBase`.
- pending positions do not contribute to converted totals.
4. Track pending metadata:
- count pending rows,
- aggregate pending local notional by currency.

## Implementation Tasks

### Task 1: Projection-Level Multi-Currency Conversion
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/portfolioProjection.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.ts`
- Test: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/portfolioProjection.test.ts`

**Changes**
- Add recalculation path to derive per-position base values and pending flags whenever:
- a position update arrives,
- an exchange rate changes,
- base currency is detected/changed.
- Emit new aggregate fields in `snapshot()`.

**Acceptance**
- EUR position in USD-base account is pending before EUR->USD FX arrives.
- Same position contributes to `positionsMarketValue` immediately after FX arrives.
- Mixed-currency positions aggregate correctly in base.

### Task 2: FX Subscription Coverage for Position Currencies
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts`
- Test: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`

**Changes**
- Track currencies from both cash balances and open positions.
- Ensure FX `reqMktData` subscriptions exist for non-base position currencies (deduplicated by currency).
- Keep existing watchdog and cleanup behavior.

**Acceptance**
- Non-base position currency triggers FX subscription once account download is complete and base currency is known.
- Currency shared by cash and position creates only one FX subscription.

### Task 3: Store-Level Display Currency State
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/state/store.ts`
- Test: `/Users/gastonrosso/Projects/ib/src/state/store.test.ts`

**Changes**
- Add state:
- `displayCurrencyPreference`,
- `displayCurrencyCode`,
- `availableDisplayCurrencies`,
- `displayCurrencyWarning`.
- Add actions:
- `setDisplayCurrencyPreference(...)`,
- `cycleDisplayCurrency(...)`.
- Resolve selected display currency on each portfolio update.
- If selected display currency is not currently convertible, fall back to base and set warning.

**Acceptance**
- Store cycles deterministically through available currencies.
- Store falls back to base when preferred display currency is not convertible yet.

### Task 4: CLI Startup Flag for Display Currency
**Files**
- Create: `/Users/gastonrosso/Projects/ib/src/config/cliArgs.ts`
- Create: `/Users/gastonrosso/Projects/ib/src/config/cliArgs.test.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/index.ts`

**Changes**
- Parse and validate `--portfolio-currency=<BASE|CCC>`.
- Normalize to uppercase.
- Fail fast on invalid values with stderr message and non-zero exit.
- Feed parsed preference into app/store initialization.

**Acceptance**
- Valid values accepted (`BASE`, `USD`, `EUR`, etc.).
- Invalid values rejected with clear message.

### Task 5: Keyboard Controls for Runtime Currency Switching
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/App.tsx`

**Changes**
- Bind `[` to previous display currency and `]` to next.
- Keep existing `c` connect and `q` quit behavior unchanged.
- Update help text to include currency controls.

**Acceptance**
- Currency changes are reflected in UI without reconnect/restart.

### Task 6: PortfolioView Multi-Currency Rendering
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx`
- Test: `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.test.tsx`

**Changes**
- Add `CCY` column in position rows.
- Highlight rows whose asset currency differs from base currency.
- Render converted market value in selected display currency.
- Show `pending` for market value and blank `% Port` when position FX is pending.
- Add header status line: display currency and base currency.
- Show warning line when fallback-to-base is active.

**Acceptance**
- Non-base assets are visibly marked.
- Portfolio totals and percentages only include converted positions.
- Display currency toggle updates rendered totals and cash values.

### Task 7: Logging and Replay Test Updates
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/src/state/store.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/utils/streamLogReplay.test.ts`

**Changes**
- Extend `state.snapshot` logging with:
- base currency,
- selected display currency,
- pending FX counts/amounts.
- Update replay invariants to accept pending-position exclusion behavior.

**Acceptance**
- Replay test still validates deterministic aggregation and catches regressions.

### Task 8: Documentation Updates
**Files**
- Modify: `/Users/gastonrosso/Projects/ib/docs/ibkr-portfolio-streams.md`
- Modify: `/Users/gastonrosso/Projects/ib/docs/architecture.md`
- Create: `/Users/gastonrosso/Projects/ib/docs/features/multi-currency-portfolio.md`

**Changes**
- Document local-vs-base semantics for positions.
- Document FX source precedence and pending behavior.
- Document new CLI flag and keyboard controls.

## Test Plan
Run:
- `npm run test -- src/broker/ibkr/portfolio/portfolioProjection.test.ts`
- `npm run test -- src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`
- `npm run test -- src/state/store.test.ts`
- `npm run test -- src/tui/PortfolioView.test.tsx`
- `npm run test -- src/broker/ibkr/IBKRBroker.test.ts`
- `npm run test -- src/utils/streamLogReplay.test.ts`
- `npm run test -- src/config/cliArgs.test.ts`
- `npm run typecheck`
- `npm run lint`

## Acceptance Criteria
- EUR (or any non-base) assets are no longer treated as base-currency values.
- Converted portfolio totals are computed in account base currency using FX.
- UI clearly indicates non-base assets and pending FX states.
- User can set startup display currency and cycle display currency at runtime.
- Portfolio positions, cash section, and totals are all expressible in selected display currency when conversion is available.

## Assumptions and Defaults
- FX map semantics remain `currency -> base` (existing behavior).
- Pending FX positions are excluded from converted totals by design.
- Display-currency list is dynamic and derived from currently observed currencies.
- If display-currency conversion is unavailable, the UI falls back to base currency with warning text.
