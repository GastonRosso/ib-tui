# Logging Refactor Plan (File-Only + Levels)

## Status

Completed on 2026-02-09.
Outcome:
- Logger refactored from boolean `debugLog()` to level-aware `log(level, stream, detail)`.
- CLI changed from `--debug-streams`/`--debug-streams-file` to `--log-file`/`--log-level`.
- Exit-time stdout message removed; logger is file-only.
- All broker callsites migrated to `event.*` stream prefix with appropriate severity.
- New `logger.test.ts` with level filtering tests; replay test updated for new format.
- Documentation updated across architecture, portfolio streams, and new `docs/features/logs.md`.

## Objective

Refactor logging so the TUI never writes debug/log noise to terminal output, keep file logging as the only sink, and add configurable log levels for better signal control.

## Current Behavior

1. CLI accepts `--debug-streams` and `--debug-streams-file=...`.
2. Logging is written to file only, but `src/index.ts` writes a final stdout note on exit when debug mode is enabled.
3. Logging API is boolean-only (`enabled`) and does not support severity filtering.

## Target Behavior

1. File is the only logging sink for app logs (no stdout/stderr logging side effects from logger).
2. Logging levels are supported and filter entries at write time.
3. CLI is simplified to one file option and one level option:
- `--log-file=<path>` enables logging to file (default: `logs/ibkr.log` when flag provided without path fallback strategy is applied in code).
- `--log-level=<error|warn|info|debug>` controls minimum severity (default: `info`).
4. No backward-compatibility aliases are kept. Legacy flags are removed in this refactor.
5. Broker callback/event logs are emitted only at `debug` level and use a consistent `event.<name>` stream prefix so replay tests can filter them deterministically.

## Implementation Plan

### Phase 1: Logger API Refactor

Files:
1. `/Users/gastonrosso/Projects/ib/src/utils/logger.ts`

Changes:
1. Replace `enabled` boolean model with a logger config model:
- `enabled`
- `filePath`
- `level`
2. Introduce level types and ordering:
- `type LogLevel = "error" | "warn" | "info" | "debug"`
3. Replace `debugLog(stream, detail)` with level-aware logger entrypoint:
- `log(level, stream, detail)`
4. Keep current fault-tolerant file writes (never crash app on logging I/O failures).
5. Standardize log line format to include level:
- `[HH:MM:SS.mmm] LEVEL stream: detail`

Acceptance checks:
1. Log entries below configured level are not written.
2. Existing call sites can migrate without changing runtime behavior (other than filtering).
3. Logger does not write to stdout/stderr.

### Phase 2: CLI Semantics and Wiring

Files:
1. `/Users/gastonrosso/Projects/ib/src/index.ts`

Changes:
1. Parse `--log-file` and `--log-level`.
2. Remove legacy `--debug-streams` and `--debug-streams-file` parsing.
3. Remove exit-time stdout message (`Debug streams log saved at ...`).
4. Configure logger once at startup with resolved file path and level.

Acceptance checks:
1. Running app with logging enabled does not pollute terminal output.
2. Invalid level values fail fast with a clear startup error.
3. Legacy flags are rejected as unsupported.

### Phase 3: Callsite Migration in Broker Layer

Files:
1. `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`

Changes:
1. Replace all `debugLog(...)` calls with level-aware calls.
2. Severity mapping baseline:
- `error` events -> `error`
- app lifecycle milestones (`connect`, `disconnect requested`) -> `info`
- IBKR callback/event logs (`updatePortfolio`, `accountValue`, `accountDownloadEnd`, emit summaries, ignored branches) -> `debug`
3. Standardize broker callback/event stream naming:
- `event.<name>` (for example `event.updatePortfolio`, `event.accountValue`, `event.emit`)
4. Keep event content stable so replay tooling remains useful.

Acceptance checks:
1. At `info` level, high-level lifecycle logs remain.
2. At `debug` level, broker event logs are available and easy to filter by `event.` prefix.
3. Error paths are always visible when logging is enabled.

### Phase 4: Tests

Files:
1. `/Users/gastonrosso/Projects/ib/src/utils/logger.test.ts` (new)
2. `/Users/gastonrosso/Projects/ib/src/utils/streamLogReplay.test.ts`

Changes:
1. Add unit tests for:
- level filtering
- default level behavior
2. Update replay parser to accept new level token in log format.
3. Update replay parser to target only `event.*` streams for broker-event invariants.
4. Keep replay invariants for emit/account consistency.

Acceptance checks:
1. `npm test` passes with updated parser.
2. Replay test works with new log line format.

### Phase 5: Documentation

Files:
1. `/Users/gastonrosso/Projects/ib/docs/ibkr-portfolio-streams.md`
2. `/Users/gastonrosso/Projects/ib/docs/architecture.md`
3. `/Users/gastonrosso/Projects/ib/docs/features/logs.md` (new)
4. `/Users/gastonrosso/Projects/ib/docs/plans/streams-simplification-account-updates-only.md` (cross-reference update only if needed)

Changes:
1. Replace `--debug-streams` docs with `--log-file` and `--log-level`.
2. Document supported levels and recommended defaults for normal troubleshooting.
3. Clarify that TUI output is intentionally untouched by logger output.
4. Document `event.*` naming for broker callback/event logs so replay tooling can filter reliably.
5. Add `/Users/gastonrosso/Projects/ib/docs/features/logs.md` with:
- logging purpose and design constraints for a TUI app
- CLI usage examples (`--log-file`, `--log-level`)
- level semantics and `event.*` convention
- sample log lines and replay-filter guidance

Acceptance checks:
1. Docs match implemented CLI behavior.
2. No stale examples using removed primary flags.
3. `/Users/gastonrosso/Projects/ib/docs/features/logs.md` exists and reflects final implementation.

## Validation Checklist

1. `npm run typecheck` passes.
2. `npm test` passes.
3. Manual run (new flags): `npm run dev -- --log-file=logs/ibkr.log --log-level=debug`.
4. TUI renders cleanly with no logger messages printed in terminal.
5. Replay test filters broker events by `event.*` and passes.

## Risks and Mitigations

1. Risk: replay tooling breaks due to log format change.
Mitigation: update parser in same PR and keep field keys stable.

2. Risk: too little logging at default level.
Mitigation: start with `info` default and keep detailed diagnostics at `debug`.

## Rollout

1. Implement on `feature/logging-file-levels`.
2. Merge with legacy flags removed and docs updated in the same change.

## Completion Notes

1. Logger API is now in `src/utils/logger.ts`: `configureLogging({ filePath, level? })`, `log(level, stream, detail)`, `isLoggingEnabled()`. Previous debug-stream exports (`debugLog`, `setDebugStreams`, `configureDebugStreams`, etc.) were removed.
2. Log line format includes padded level tag: `[HH:MM:SS.mmm] LEVEL stream: detail`. Level is uppercase, right-padded to 5 chars for alignment.
3. `IBKRBroker.test.ts` mock updated from `debugLog` to `log`.
4. Replay parser (`streamLogReplay.test.ts`) updated: regex captures level token, broker callbacks use `event.*` prefixes, and session header detection uses `log session start`.
5. All 39 tests pass, lint clean, build succeeds.
