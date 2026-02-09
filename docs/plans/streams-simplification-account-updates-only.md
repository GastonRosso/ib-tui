# Streams Simplification Plan (Account Updates Only)

## Status

Implemented on 2026-02-09.

## Completion and Resolution

1. Simplification completed with `reqAccountUpdates` as the only active portfolio subscription.
2. `reqPnL` and `reqPnLSingle` were removed from runtime, tests, and docs.
3. `MarketValueChart` and its dependency were removed.
4. Recency label (`Updated X ago`) and stale threshold (`>= 180s`) were implemented.
5. `NetLiquidation` was explicitly removed from runtime behavior in this feature to avoid mixed-source freshness signals.
6. Decision: reintroduce broker-reported equity (`NetLiquidation` for IBKR) later as a separate feature with explicit dual-metric modeling.

## Objective

Simplify portfolio data flow by removing high-frequency `reqPnL` and `reqPnLSingle` subscriptions and relying on `reqAccountUpdates` (`updatePortfolio`, `updateAccountValue`, `accountDownloadEnd`) as the single source for dashboard state.

## Why This Change

1. Reduce cross-stream drift and merge complexity.
2. Eliminate startup/periodic mismatches from mixed valuation pipelines.
3. Keep behavior deterministic and easier to debug for a general dashboard use case.

## Expected Tradeoff

1. Lower refresh cadence (event-driven + periodic account refresh, often minutes).
2. Less smooth chart motion compared to near-1s `pnlSingle`.

## Scope

In scope:
1. Remove `reqPnL` and `reqPnLSingle` wiring from broker subscription lifecycle.
2. Remove state/UI readiness logic tied to PnL streams.
3. Keep cash inside portfolio total (`totalEquity = positionsMarketValue + cashBalance`).
4. Remove the portfolio market value chart from this simplified dashboard mode.
5. Add a clear recency indicator (`Updated X ago`) based on latest portfolio update timestamp.
6. Mark data as stale when no update has arrived for 3 minutes.
7. Preserve debug logging, now focused on account-update streams.
8. Update tests and docs to match simplified contract.
9. Remove all unused code and dependencies left behind by the refactor.

Out of scope:
1. Reintroducing real-time market data via `reqMktData` in this iteration.
2. Advanced reconciliation against execution or trade streams.

## Target Data Contract

`PortfolioUpdate` will carry:
1. `positions`
2. `positionsMarketValue`
3. `cashBalance`
4. `totalEquity`
5. `initialLoadComplete`
6. `lastPortfolioUpdateAt` (epoch ms) for recency display and stale detection

Ownership:
1. `updatePortfolio` owns position structure and valuation fields.
2. `updateAccountValue` owns `cashBalance`.
3. `accountDownloadEnd` owns initial load completion.

## Implementation Plan

### Phase 1: Broker Simplification

Files:
1. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`
2. `/Users/gastonrosso/Projects/ib/src/broker/types.ts`

Changes:
1. Remove `reqPnL` request/cancel and `EventName.pnl` handler.
2. Remove `reqPnLSingle` request/cancel mapping and `EventName.pnlSingle` handler.
3. Remove realtime overlay/staleness logic (`pnlSingleActive`, age windows, overlay preserve branches).
4. Keep `updatePortfolio` as direct valuation source.
5. Keep `updateAccountValue` handling only for `TotalCashBalance` (`BASE`).
6. Emit updates from account events and portfolio events with deterministic recomputation.

Acceptance checks:
1. No remaining references to `reqPnL`, `cancelPnL`, `reqPnLSingle`, `cancelPnLSingle`.
2. Subscriptions/unsubscriptions remain balanced and leak-free.

### Phase 2: State + UI Contract Cleanup

Files:
1. `/Users/gastonrosso/Projects/ib/src/state/store.ts`
2. `/Users/gastonrosso/Projects/ib/src/state/store.test.ts`
3. `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx`
4. `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.test.tsx`

Changes:
1. Remove `positionPnlReady` / `accountPnlReady` fields and related placeholder rendering.
2. Remove `MarketValueChart` from `PortfolioView` in this mode.
3. Decide Day P&L behavior:
- Option A (preferred): remove Day P&L columns from this simplified mode.
- Option B: keep columns but mark as unavailable (`--`) consistently.
4. Add `lastPortfolioUpdateAt` state field, set from each broker emit.
5. Add `Updated X ago` UI label (local 1s timer in UI only).
6. Add stale visual state when age is greater than or equal to 180 seconds.
7. Keep startup handling with `initialLoadComplete`.

Acceptance checks:
1. UI no longer flips from placeholder to PnL-derived values after startup.
2. Table and totals remain internally consistent under account-update cadence.
3. Chart is not rendered in simplified mode.
4. Recency indicator increments once per second and staleness triggers at 3 minutes.

### Phase 3: Logging and CLI Semantics

Files:
1. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/debug.ts`
2. `/Users/gastonrosso/Projects/ib/src/index.ts`
3. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`

Changes:
1. Keep `--debug-streams` and `--debug-streams-file`.
2. Remove logging branches related to removed PnL streams.
3. Keep high-signal logs for:
- connection lifecycle
- `updatePortfolio`
- `updateAccountValue`
- `accountDownloadEnd`
- emitted summary values
4. Document log schema for replay tooling.

Acceptance checks:
1. Debug mode writes only active streams and no dead-event noise.
2. TUI output remains clean (file logging only).

### Phase 4: Replay Test Adaptation

Files:
1. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/streamLogReplay.test.ts`
2. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.test.ts`

Changes:
1. Update replay invariants to account-update-only model.
2. Remove startup drift assertion between `updatePortfolio` and `pnlSingle` (stream no longer exists).
3. Add invariants for deterministic emits:
- position sum correctness
- cash correctness
- total correctness
4. Add regression test ensuring no `pnl`/`pnlSingle` events are subscribed or emitted.

Acceptance checks:
1. Replay test passes on new logs without stream-drift assertions.
2. Unit tests cover simplified lifecycle.

### Phase 5: Documentation Update

Files:
1. `/Users/gastonrosso/Projects/ib/docs/architecture.md`
2. `/Users/gastonrosso/Projects/ib/docs/ibkr-portfolio-streams.md`
3. `/Users/gastonrosso/Projects/ib/docs/features/market-value-chart.md`

Changes:
1. Update architecture section to single-stream ownership model.
2. Explicitly document cadence expectations (not near-1s).
3. Document chart removal rationale for this mode.
4. Document `Updated X ago` and stale threshold (180s) behavior.
5. Document why this mode was chosen and tradeoffs.
6. Add “future option” section for reintroducing real-time marks via `reqMktData`.

Acceptance checks:
1. Docs match runtime behavior and test assumptions.
2. No references to removed PnL merge logic as active behavior.

### Phase 6: Dead Code and Dependency Cleanup

Files:
1. `/Users/gastonrosso/Projects/ib/package.json`
2. `/Users/gastonrosso/Projects/ib/package-lock.json`
3. Any now-unused source/test files discovered during refactor

Changes:
1. Remove orphaned helper code no longer reachable after dropping PnL streams.
2. Remove unused chart-related code paths in simplified mode.
3. Remove dependencies that are no longer used after cleanup.
4. Remove or rewrite tests that target deleted behavior.

Acceptance checks:
1. No unused exports/types left from removed stream logic.
2. No unused direct dependencies related to removed functionality.
3. `npm test` and `npm run typecheck` stay green after cleanup.

## Validation Checklist

1. `npm run typecheck` passes.
2. `npm test` passes.
3. Manual run with `npm run dev -- --debug-streams --debug-streams-file=logs/ibkr-streams.log`.
4. Startup shows one consistent snapshot path (no PnL handoff jump).
5. Recency label appears and updates every second after first snapshot.
6. Data is marked stale if 3 minutes pass without updates.
7. After 10+ minutes runtime, no periodic cross-stream snap-back (because cross-stream merge removed).

## Risks and Mitigations

1. Risk: perceived staleness in moving markets.
Mitigation: document cadence; optionally add timestamp “last update at” in UI.

2. Risk: loss of Day P&L visibility.
Mitigation: mark unavailable clearly now; design a dedicated real-time mode later.

3. Risk: hidden reliance on removed readiness flags.
Mitigation: remove fields at type level and fix compile errors rather than soft deprecating.

## Rollout

1. Implement on `feature/streams-simplification`.
2. Validate with replay + manual debug logs from real session.
3. Merge once dashboard behavior is stable and docs are aligned.
