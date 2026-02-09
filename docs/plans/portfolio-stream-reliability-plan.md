# Portfolio Stream Reliability Plan

## Status

Completed on 2026-02-09.

Outcome:
- Implemented stream diagnostics, merge hardening, and replay-based validation.
- Confirmed startup/value drift is an expected IBKR cross-stream timing mismatch (`updatePortfolio` vs `pnlSingle`), not a local arithmetic bug.
- Decided to keep current behavior in this branch and handle stream simplification as a separate follow-up feature.

## Context

We currently merge multiple IBKR streams for portfolio display and charting:
- `updatePortfolio` (`reqAccountUpdates`)
- `pnl` (`reqPnL`)
- `pnlSingle` (`reqPnLSingle`)
- `updateAccountValue` (`reqAccountUpdates`)

Detailed stream inventory is documented in `/Users/gastonrosso/Projects/ib/docs/ibkr-portfolio-streams.md`.

Observed issues:
- Brief low portfolio total during startup.
- Occasional snap-back to a previously lower value after several minutes.
- Short period of `0.00` Day P&L right after load.
- Chart cadence/shape affected by inconsistent upstream update cadence.

## Goals

1. Make total portfolio value stable and deterministic.
2. Keep near-1s responsiveness for visual updates.
3. Treat cash as part of the primary portfolio total.
4. Add opt-in stream debugging that is safe for normal use.
5. Keep source-of-truth boundaries explicit and testable.

## Non-goals

1. Implement full order/execution reconciliation.
2. Replace IBKR streams with polling.
3. Add persistent logging storage in this iteration.

## Design Decisions

### A) Portfolio semantics

Use explicit metrics in state:
- `positionsMarketValue`: sum of position market values.
- `cashBalance`: from account values.
- `totalEquity`: primary headline metric, includes cash.
- `accountDailyPnL`: account-level day P&L.

UI/Chart should use `totalEquity` as the canonical portfolio total.

### B) Stream ownership model

Single-owner model with optional realtime overlay:
- `updatePortfolio` owns position lifecycle, quantity, avgCost, canonical marketPrice/marketValue.
- `pnlSingle` owns position P&L fields (`dailyPnL`, `unrealizedPnL`, `realizedPnL`).
- `pnl` owns account day P&L.
- `updateAccountValue` owns cash and account-level totals (including `NetLiquidation` when available).

Optional (guarded) realtime valuation overlay from `pnlSingle.value`:
- Keep canonical valuation untouched.
- Use overlay only for display/chart if sanity checks pass.
- Rebase/clear overlay on canonical updates, reconnect, or account reset indicators.

### C) Account-level total source

Prefer `NetLiquidation` (BASE) from `updateAccountValue` for `totalEquity` when present.
Fallback:
- `sum(positions marketValue) + cashBalance`.

This reduces drift caused by mixed stream timing.

### D) Startup/readiness

Readiness gates:
- Keep current `initialLoadComplete` gate.
- Introduce a secondary `pnlReady` gate (first account `pnl` tick) for final totals section.
- Until `pnlReady`, render Day P&L as placeholder (`--`) instead of `0.00`.

### E) Debug logging (CLI argument)

Add command-line flag:
- `--debug-streams`

Behavior:
- Disabled by default.
- When enabled, print compact per-event logs with timestamp and stream name:
  - `updatePortfolio` (conId, qty, mktPrice, mktValue)
  - `pnlSingle` (conId, daily/unreal/realized, value, pos)
  - `pnl` (accountDailyPnL)
  - `updateAccountValue` (key, currency, value)
  - `accountDownloadEnd`
- Include one-line merge result log when emitted (`positionsMarketValue`, `cashBalance`, `totalEquity`).

Implementation shape:
- Parse args in `/Users/gastonrosso/Projects/ib/src/index.ts`.
- Provide a runtime config object (or env bridge) consumable by broker/store.
- Keep logs centralized in broker merge layer to avoid UI noise.

## Implementation Phases

### Phase 1: Data model + naming cleanup

Changes:
- Add state fields for `positionsMarketValue` and `totalEquity`.
- Migrate UI total and chart to `totalEquity`.
- Keep backward compatibility temporarily for existing selectors, then remove old field usage.

Files:
- `/Users/gastonrosso/Projects/ib/src/state/store.ts`
- `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx`
- `/Users/gastonrosso/Projects/ib/src/tui/MarketValueChart.tsx`

### Phase 2: Stream merge hardening

Changes:
- Implement explicit ownership map in broker merge code.
- Parse and track `NetLiquidation` from `updateAccountValue`.
- Compute `totalEquity` from `NetLiquidation` when available, fallback otherwise.
- Add optional guarded overlay path for `pnlSingle.value` (feature-flagged in code, default off initially).

Files:
- `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`
- `/Users/gastonrosso/Projects/ib/src/broker/types.ts`

### Phase 3: Debug logging + CLI integration

Changes:
- Add `--debug-streams` parsing.
- Thread debug flag to broker layer.
- Add concise event logs and merge output logs.

Files:
- `/Users/gastonrosso/Projects/ib/src/index.ts`
- `/Users/gastonrosso/Projects/ib/src/tui/App.tsx` (only if prop threading is needed)
- `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`

### Phase 4: Tests and docs

Changes:
- Add tests for ownership guarantees and `totalEquity` fallback logic.
- Add tests for readiness behavior (`pnlReady` placeholder display).
- Update architecture + stream docs with final contract and debug flag usage.

Files:
- `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.test.ts`
- `/Users/gastonrosso/Projects/ib/src/state/store.test.ts`
- `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.test.tsx`
- `/Users/gastonrosso/Projects/ib/docs/architecture.md`
- `/Users/gastonrosso/Projects/ib/docs/ibkr-portfolio-streams.md`

## Validation Checklist

1. Startup:
- No visible low-value flash after initial load.
- Day P&L shows placeholder until first valid tick; no misleading `0.00`.

2. Runtime stability:
- No periodic snap-back to stale lower total under steady market conditions.
- Chart updates at stable cadence and uses `totalEquity`.

3. Debugability:
- `npm run dev -- --debug-streams` prints stream events + merge summary.
- Default run has no extra logs.

4. Regression safety:
- `npm test` and `npm run typecheck` pass.

## Risks and Mitigations

1. Risk: `NetLiquidation` missing or delayed on some accounts.
- Mitigation: fallback computation and explicit source marker in debug logs.

2. Risk: overlay path introduces new race conditions.
- Mitigation: keep overlay feature-flagged, default off; add targeted tests before enabling.

3. Risk: log volume too high.
- Mitigation: compact log format and optional rate-limited summary mode.

## Rollout Strategy

1. Ship Phase 1 + Phase 2 first (without overlay enabled).
2. Validate with real account using `--debug-streams`.
3. If valuation cadence is still insufficient, enable guarded overlay in a follow-up patch.

## Completion Notes

1. Phases 1-4 were implemented in this branch, including tests and documentation.
2. Replay test reproduces and pinpoints startup drift from captured logs.
3. Next work is split into a new feature branch focused on stream simplification.
