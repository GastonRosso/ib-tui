# Logging

## Purpose

The app is a TUI — all terminal output belongs to the UI. Logging is file-only so debug diagnostics never corrupt the rendered interface.

## CLI Usage

Enable logging by passing `--log-file`:

```bash
# Default path (logs/ibkr.log), default level (info)
npm run dev -- --log-file

# Custom path and level
npm run dev -- --log-file=logs/debug.log --log-level=debug
```

Flags:
- `--log-file[=<path>]` — Enable file logging. Default path: `logs/ibkr.log`.
- `--log-level=<error|warn|info|debug>` — Minimum severity written. Default: `info`.

Invalid level values cause a startup error.

## Log Levels

| Level | Use |
|-------|-----|
| `error` | IBKR API errors, connection failures |
| `warn` | Reserved for future use |
| `info` | App lifecycle: connect request, disconnect request, subscription start/stop |
| `debug` | Broker callback/event data: `connected`, `disconnected`, `managedAccounts`, `nextValidId`, `updatePortfolio`, `accountValue`, `accountDownloadEnd`, and `emit` |

At `info` level you see high-level lifecycle milestones. At `debug` level you get full event traces useful for diagnosing data issues.

## Log Format

```
[HH:MM:SS.mmm] LEVEL stream: detail
```

Example lines:

```
[14:32:01.123] INFO  connection: connect host=127.0.0.1 port=4002 clientId=1
[14:32:01.456] DEBUG event.connected: received
[14:32:01.789] DEBUG event.managedAccounts: accounts=DU123456 selectedAccount=DU123456
[14:32:02.100] DEBUG event.updatePortfolio: received account=DU123456 conId=265598 sym=AAPL qty=100 mktPrice=150.50 mktValue=15050.00
[14:32:02.101] DEBUG event.emit: positionsMV=15050.00 cash=5000.00 totalEquity=20050.00
```

## Stream Naming Convention

Broker callback/event log streams use the `event.*` prefix:

- `event.updatePortfolio` — position updates from IBKR
- `event.accountValue` — account value updates (cash balance)
- `event.accountDownloadEnd` — end of initial account snapshot
- `event.emit` — portfolio update emitted to the app
- `event.nextValidId` — order ID assignment
- `event.connected` — socket connected callback
- `event.disconnected` — socket disconnected callback
- `event.managedAccounts` — account list callback

Non-event streams (no prefix): `connection`, `subscription`, `error`.

## Log Replay Test

The replay test (`src/utils/streamLogReplay.test.ts`) re-processes a captured log file and verifies that every `event.emit` line is consistent with the portfolio state built up from preceding `event.updatePortfolio` and `event.accountValue` entries.

### What it checks

1. `positionsMV` in each emit matches the sum of replayed position market values.
2. `cash` in each emit matches the last replayed `TotalCashBalance`.
3. `totalEquity` in each emit matches `positionsMV + cash`.
4. No `reqPnL` or `reqPnLSingle` subscriptions appear (regression guard).

### How to run

Point `IBKR_STREAM_LOG_PATH` at a log file captured with `--log-level=debug`:

```bash
# 1. Capture a log with debug level (includes all event.* entries)
npm run dev -- --log-file=logs/ibkr.log --log-level=debug

# 2. Run the replay test against the captured log
IBKR_STREAM_LOG_PATH=logs/ibkr.log npm test -- --grep "stream log replay"
```

Without `IBKR_STREAM_LOG_PATH` set, the test is silently skipped.

### Filtering logs manually

The `event.*` prefix makes it straightforward to filter broker event logs:

```bash
# All broker events
grep 'event\.' logs/ibkr.log

# Only portfolio updates
grep 'event.updatePortfolio' logs/ibkr.log

# Only emits (useful for checking computed values)
grep 'event.emit' logs/ibkr.log
```

## Design Constraints

1. Logger never writes to stdout or stderr.
2. Logger never crashes the app — all I/O failures are silently swallowed.
3. Each session starts with a header line: `=== log session start <ISO timestamp> pid=<pid> level=<level> ===`.
