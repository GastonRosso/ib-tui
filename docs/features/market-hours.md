# Market Hours

Per-position market hours status displayed as a color-coded countdown in the portfolio table. Each position shows when its market will close (if open) or open (if closed), using the asset's own exchange schedule and timezone.

## How It Works

The `Mkt Hrs` column in the portfolio table shows a countdown like `6h 0m to close` or `9h 0m to open`. The text color indicates the current market hours status:

| Color | Status | Meaning |
|-------|--------|---------|
| Green | Open | Market is currently in liquid hours |
| Yellow | Closed | Market is outside liquid hours |
| Default | Unknown | No market hours data available |

When no data is available (e.g. contract details haven't arrived yet), the column shows `n/a`.

The countdown refreshes every 30 seconds via a local timer, so it continues updating even when no broker events are flowing.

## Architecture

The feature spans three layers:

```
IBKRBroker                    Pure Utility                  UI
reqContractDetails ──►  resolveMarketHours()  ──►  PortfolioView
(per conId, cached)     (deterministic, testable)    (Mkt Hrs column)
```

### 1. Data Enrichment (`src/broker/ibkr/IBKRBroker.ts`)

When `subscribePortfolio()` receives a position via `updatePortfolio`, it checks whether contract details have been fetched for that `conId`. If not, it calls `reqContractDetails` to retrieve the exchange schedule.

Key internals:
- `marketHoursByConId` — `Map<number, PositionMarketHours>` cache. Populated once per conId, never re-requested.
- `reqIdToConId` — maps IB request IDs back to contract IDs for correlating `contractDetails` responses.
- `pendingConIds` — tracks in-flight requests to avoid duplicates.
- Request IDs start at `90_000` to avoid collisions with other IB API request sequences.

On receiving `contractDetails`, the broker extracts three fields and caches them:

```typescript
{
  timeZoneId: details.timeZoneId ?? null,   // e.g. "MET", "US/Eastern"
  liquidHours: details.liquidHours ?? null, // e.g. "20260210:0930-20260210:1600"
  tradingHours: details.tradingHours ?? null,
}
```

If the position already exists in the local map, it is immediately re-enriched and a portfolio update is emitted so the UI reflects the new data.

### 2. Market Hours Calculator (`src/broker/ibkr/marketHours.ts`)

A pure, side-effect-free module that determines whether a market is open or closed at a given point in time.

**Exports:**

```typescript
resolveMarketHours(marketHours, nowMs?) → MarketHoursStatus
formatMarketHoursCountdown(status) → string
```

**Types:**

```typescript
type PositionMarketHours = {
  timeZoneId: string | null;
  liquidHours: string | null;
  tradingHours: string | null;
};

type MarketHoursStatus = {
  status: "open" | "closed" | "unknown";
  minutesToNextTransition: number | null;
  transition: "open" | "close" | null;
};
```

**Algorithm:**

1. Select schedule: `liquidHours` is preferred over `tradingHours`.
2. Parse the IB hours string into time windows (see format details below).
3. Convert the current time (`nowMs`) to local time in the exchange timezone using `Intl.DateTimeFormat`.
4. Compare the current local minute-key against the parsed windows.
5. If inside a window: status is `open`, countdown is minutes to window end.
6. If before a future window: status is `closed`, countdown is minutes to window start.
7. If after all windows: status is `closed`, no countdown available.

**Deterministic design:** The `nowMs` parameter defaults to `Date.now()` but can be injected for testing, making all tests fully deterministic with no dependency on wall-clock time.

### 3. UI Rendering (`src/tui/PortfolioView.tsx`)

`PositionRow` calls `resolveMarketHours(position.marketHours, nowMs)` and renders the formatted countdown with the appropriate color. The `nowMs` value is held in component state and refreshed every 30 seconds via `setInterval`.

## IB Hours Format

IB's `liquidHours` and `tradingHours` strings come in two formats depending on TWS version:

**Legacy (pre-v970):**
```
20260210:0930-1600;20260211:0930-1600
```
Structure: `YYYYMMDD:HHMM-HHMM` — date prefix applies to both start and end times.

**v970+ format:**
```
20260210:0930-20260210:1600;20260211:0930-20260211:1600
```
Structure: `YYYYMMDD:HHMM-YYYYMMDD:HHMM` — date is explicit on both sides of the dash.

**Closed days:**
```
20260214:CLOSED;20260215:0930-1600
```

**Multiple sessions per day (comma-separated):**
```
20260210:0930-1200,1300-1600
```

The parser handles all of these by splitting on the first colon to extract the day prefix, then checking each start/end token for embedded colons to detect v970+ format.

## Known Limitation: Legacy Overnight Sessions (Derivatives)

The current legacy parser path (`YYYYMMDD:HHMM-HHMM`) assumes start and end belong to the same calendar day. That is fine for most cash-equity sessions, but it can mis-handle overnight derivative sessions where the close time is on the next day and therefore numerically earlier than the open time.

Example legacy session:
```
20260210:1700-1600
```

For this case, `1600` should be interpreted as next-day close. Today, this kind of legacy overnight window can be dropped, which may surface as `unknown`/incorrect market-hours state for futures or other derivatives.

Planned adjustment when implementing derivatives:
- Treat legacy ranges with `end <= start` as next-day end.
- Add regression tests for overnight legacy sessions across multiple timezones.

## Timezone Handling

IB sends timezone abbreviations that are not valid IANA identifiers. The market hours calculator normalizes them before use:

| IB Abbreviation | IANA Identifier |
|-----------------|-----------------|
| EST, EDT | America/New_York |
| CST, CDT | America/Chicago |
| PST, PDT | America/Los_Angeles |
| JST | Asia/Tokyo |
| HKT | Asia/Hong_Kong |
| GMT, BST | Europe/London |
| CET, CEST | Europe/Berlin |
| MET, MEST | Europe/Berlin |

IB's `EST` means the US Eastern exchange, not the fixed UTC-5 offset. The normalization maps it to `America/New_York`, which correctly handles DST transitions. For example, at 15:00 UTC in July, `America/New_York` resolves to 11:00 EDT (not 10:00 EST).

Identifiers that are already IANA-valid (e.g. `US/Eastern`, `Asia/Tokyo`) pass through unchanged.

If a timezone is unrecognized by `Intl.DateTimeFormat`, the `try/catch` around `toLocalParts` catches the error and returns `"unknown"` status gracefully.

## Logging

When file logging is enabled at `debug` level, the broker logs contract details requests and responses:

```
[14:32:02.200] DEBUG event.reqContractDetails: reqId=90000 conId=265598 sym=AAPL
[14:32:02.350] DEBUG event.contractDetails: reqId=90000 conId=265598 tz=US/Eastern liquid=20260210:0930-20260210:1600;...
```

These entries help diagnose cases where market hours data is missing or incorrect.

## Test Coverage

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `src/broker/ibkr/marketHours.test.ts` | 7 | US equity open/close, Tokyo timezone, EST alias with DST, v970+ format, null/unknown edge cases |
| `src/broker/ibkr/IBKRBroker.test.ts` | 1 (of 15) | Contract details request, cache, and position enrichment |
| `src/tui/PortfolioView.test.tsx` | 2 (of 12) | Countdown rendering for single market and multi-market (NY open + Tokyo closed) |

All market hours tests inject `nowMs` explicitly, making them deterministic and independent of wall-clock time.

## Files

| File | Role |
|------|------|
| `src/broker/ibkr/marketHours.ts` | Pure market hours calculator and IB hours parser |
| `src/broker/ibkr/marketHours.test.ts` | Market hours calculator tests |
| `src/broker/types.ts` | `PositionMarketHours` type (canonical) and `Position.marketHours` field |
| `src/broker/ibkr/IBKRBroker.ts` | Contract details enrichment in `subscribePortfolio()` |
| `src/tui/PortfolioView.tsx` | `Mkt Hrs` column rendering with color |

## Design Decisions

1. **Pure utility over stateful service.** The market hours calculator has no side effects, no state, and no dependencies beyond `Intl.DateTimeFormat`. This makes it trivially testable and reusable.

2. **Cache, don't re-fetch.** Contract details are requested once per `conId` and cached for the connection lifetime. Market schedules change infrequently and the IB API rate-limits `reqContractDetails`.

3. **Liquid hours over trading hours.** `liquidHours` represents regular trading hours (the period most relevant to retail traders). `tradingHours` includes extended/pre-market hours and is used as a fallback only when `liquidHours` is unavailable.

4. **Color over labels.** The column uses green/yellow text color instead of a separate OPEN/CLOSED label column. This saves horizontal space in the terminal while remaining instantly readable.

5. **30-second refresh.** The countdown timer fires every 30 seconds, which is sufficient granularity for hour-level countdowns without unnecessary re-renders.
