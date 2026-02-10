# Per-Position Market Hours Status and Countdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Distinguish open-market vs closed-market positions and show `Xh Ym to close` or `Xh Ym to open` for each position using that asset's own market hours.

**Architecture:** Keep market-hours logic in a pure utility module so it is deterministic and easy to test. Enrich each position in `IBKRBroker` with market schedule metadata from `reqContractDetails` (timezone + liquid/trading hours), cache it by `conId`, and emit updates when details arrive. Render a single `Mkt Hrs` countdown column in `PortfolioView` with color-coded text (green=open, yellow=closed) and refresh a lightweight local clock so countdowns continue updating even if broker streams are quiet.

**Tech Stack:** TypeScript, Vitest, Ink, Zustand, `@stoqey/ib` (`reqContractDetails`, `contractDetails`, `contractDetailsEnd`), Node `Intl.DateTimeFormat`.

**Supporting Skills:** @typescript-expert

## Status

Completed on 2026-02-10.

Outcome:
- All 4 tasks implemented with passing tests (50 total across 6 test files).
- Typecheck and lint clean.
- Column widths adjusted to fit 100-char terminal width used by ink-testing-library.

---

## Preconditions

- Use a dedicated worktree for implementation.
- Keep commits task-scoped and small.
- Follow DRY/YAGNI and strict TDD for each behavior change.

### Task 1: Build deterministic market-session calculator

**Files:**
- Create: `src/marketHours/session.ts`
- Test: `src/marketHours/session.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveMarketSession, formatSessionCountdown } from "./session.js";

describe("resolveMarketSession", () => {
  it("returns OPEN and time-to-close for US equity hours", () => {
    const now = Date.parse("2026-02-10T15:00:00.000Z"); // 10:00 New York
    const session = resolveMarketSession(
      {
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: "20260210:0400-2000;20260211:0400-2000",
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatSessionCountdown(session)).toBe("6h 0m to close");
  });

  it("returns CLOSED and time-to-open after close", () => {
    const now = Date.parse("2026-02-10T22:00:00.000Z"); // 17:00 New York
    const session = resolveMarketSession(
      {
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("closed");
    expect(formatSessionCountdown(session)).toBe("16h 30m to open");
  });

  it("handles a different market timezone for another asset", () => {
    const now = Date.parse("2026-02-10T01:00:00.000Z"); // 10:00 Tokyo
    const session = resolveMarketSession(
      {
        timeZoneId: "Asia/Tokyo",
        liquidHours: "20260210:0900-1500;20260211:0900-1500",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatSessionCountdown(session)).toBe("5h 0m to close");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/marketHours/session.test.ts`
Expected: FAIL with module-not-found or missing export errors for `resolveMarketSession`.

**Step 3: Write minimal implementation**

```ts
export type PositionMarketHours = {
  timeZoneId: string | null;
  liquidHours: string | null;
  tradingHours: string | null;
};

export type MarketSessionStatus = "open" | "closed" | "unknown";

export type MarketSession = {
  status: MarketSessionStatus;
  minutesToNextTransition: number | null;
  transition: "open" | "close" | null;
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type Window = { startKey: number; endKey: number };

const toLocalParts = (epochMs: number, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
};

const toMinuteKey = (p: LocalParts): number =>
  Math.floor(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 60_000);

const parseDate = (yyyymmdd: string, hhmm: string): LocalParts => ({
  year: Number(yyyymmdd.slice(0, 4)),
  month: Number(yyyymmdd.slice(4, 6)),
  day: Number(yyyymmdd.slice(6, 8)),
  hour: Number(hhmm.slice(0, 2)),
  minute: Number(hhmm.slice(2, 4)),
});

const parseIbHours = (hours: string): Window[] => {
  const windows: Window[] = [];

  for (const daySegment of hours.split(";")) {
    const [day, rawRanges] = daySegment.split(":");
    if (!day || !rawRanges || rawRanges === "CLOSED") continue;

    for (const rawRange of rawRanges.split(",")) {
      const [startRaw, endRaw] = rawRange.split("-");
      if (!startRaw || !endRaw) continue;

      const [startDate, startTime] = startRaw.includes(":")
        ? startRaw.split(":")
        : [day, startRaw];

      const [endDate, endTime] = endRaw.length > 4
        ? [endRaw.slice(0, 8), endRaw.slice(8)]
        : [day, endRaw];

      const startKey = toMinuteKey(parseDate(startDate, startTime));
      const endKey = toMinuteKey(parseDate(endDate, endTime));
      if (endKey > startKey) windows.push({ startKey, endKey });
    }
  }

  return windows.sort((a, b) => a.startKey - b.startKey);
};

export const resolveMarketSession = (
  marketHours: PositionMarketHours | null | undefined,
  nowMs = Date.now()
): MarketSession => {
  if (!marketHours?.timeZoneId) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const schedule = marketHours.liquidHours ?? marketHours.tradingHours;
  if (!schedule) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const windows = parseIbHours(schedule);
  if (windows.length === 0) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const nowKey = toMinuteKey(toLocalParts(nowMs, marketHours.timeZoneId));
  const active = windows.find((w) => nowKey >= w.startKey && nowKey < w.endKey);
  if (active) {
    return {
      status: "open",
      minutesToNextTransition: active.endKey - nowKey,
      transition: "close",
    };
  }

  const next = windows.find((w) => w.startKey > nowKey);
  if (next) {
    return {
      status: "closed",
      minutesToNextTransition: next.startKey - nowKey,
      transition: "open",
    };
  }

  return { status: "closed", minutesToNextTransition: null, transition: null };
};

export const formatSessionCountdown = (session: MarketSession): string => {
  if (!session.transition || session.minutesToNextTransition === null) return "n/a";
  const hours = Math.floor(session.minutesToNextTransition / 60);
  const minutes = session.minutesToNextTransition % 60;
  return `${hours}h ${minutes}m to ${session.transition}`;
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/marketHours/session.test.ts`
Expected: PASS for all new market-session tests.

**Step 5: Commit**

```bash
git add src/marketHours/session.ts src/marketHours/session.test.ts
git commit -m "feat: add per-market session calculator"
```

### Task 2: Enrich broker positions with market-hours metadata

**Files:**
- Modify: `src/broker/types.ts`
- Modify: `src/broker/ibkr/IBKRBroker.ts`
- Test: `src/broker/ibkr/IBKRBroker.test.ts`

**Step 1: Write the failing test**

```ts
it("requests contract details and enriches positions with marketHours", () => {
  const callback = vi.fn();
  broker.subscribePortfolio(callback);

  mockApi.emit(
    EventName.updatePortfolio,
    { symbol: "AAPL", conId: 265598, currency: "USD", exchange: "SMART", secType: "STK" },
    100, 150.5, 15050, 145.0, 550, 0, "DU123456"
  );

  expect(mockApi.reqContractDetails).toHaveBeenCalledTimes(1);
  const [reqId] = mockApi.reqContractDetails.mock.calls[0];

  mockApi.emit(EventName.contractDetails, reqId, {
    contract: { conId: 265598 },
    timeZoneId: "America/New_York",
    liquidHours: "20260210:0930-1600;20260211:0930-1600",
    tradingHours: "20260210:0400-2000;20260211:0400-2000",
  });
  mockApi.emit(EventName.contractDetailsEnd, reqId);

  const lastCall = callback.mock.calls.at(-1)?.[0];
  expect(lastCall.positions[0].marketHours).toEqual({
    timeZoneId: "America/New_York",
    liquidHours: "20260210:0930-1600;20260211:0930-1600",
    tradingHours: "20260210:0400-2000;20260211:0400-2000",
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/IBKRBroker.test.ts -t "requests contract details and enriches positions with marketHours"`
Expected: FAIL because `reqContractDetails` and `marketHours` enrichment do not exist yet.

**Step 3: Write minimal implementation**

```ts
// src/broker/types.ts
export type PositionMarketHours = {
  timeZoneId: string | null;
  liquidHours: string | null;
  tradingHours: string | null;
};

export type Position = {
  // existing fields...
  marketHours?: PositionMarketHours;
};
```

```ts
// src/broker/ibkr/IBKRBroker.ts (inside subscribePortfolio)
const marketHoursByConId = new Map<number, PositionMarketHours>();
const reqIdToConId = new Map<number, number>();
const pendingConIds = new Set<number>();
let nextContractDetailsReqId = 90_000;

const requestContractDetailsIfNeeded = (contract: Contract, conId: number) => {
  if (marketHoursByConId.has(conId) || pendingConIds.has(conId)) return;
  const reqId = nextContractDetailsReqId++;
  pendingConIds.add(conId);
  reqIdToConId.set(reqId, conId);
  api.reqContractDetails(reqId, {
    conId,
    symbol: contract.symbol,
    currency: contract.currency,
    exchange: contract.exchange ?? "SMART",
    secType: contract.secType,
  });
};

const onContractDetails = (reqId: number, details: ContractDetails) => {
  const conId = reqIdToConId.get(reqId) ?? details.contract?.conId;
  if (!conId) return;

  marketHoursByConId.set(conId, {
    timeZoneId: details.timeZoneId ?? null,
    liquidHours: details.liquidHours ?? null,
    tradingHours: details.tradingHours ?? null,
  });

  const existing = positions.get(conId);
  if (existing) {
    positions.set(conId, { ...existing, marketHours: marketHoursByConId.get(conId) });
    emitUpdate();
  }
};

const onContractDetailsEnd = (reqId: number) => {
  const conId = reqIdToConId.get(reqId);
  if (conId) pendingConIds.delete(conId);
  reqIdToConId.delete(reqId);
};

// in onPortfolioUpdate(), when building position:
const position: Position = {
  // existing fields...
  marketHours: marketHoursByConId.get(conId),
};
requestContractDetailsIfNeeded(contract, conId);

// subscription wiring
api.on(EventName.contractDetails, onContractDetails);
api.on(EventName.contractDetailsEnd, onContractDetailsEnd);
// cleanup on unsubscribe
api.removeListener(EventName.contractDetails, onContractDetails);
api.removeListener(EventName.contractDetailsEnd, onContractDetailsEnd);
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/broker/ibkr/IBKRBroker.test.ts`
Expected: PASS, including new contract-details enrichment behavior and existing broker coverage.

**Step 5: Commit**

```bash
git add src/broker/types.ts src/broker/ibkr/IBKRBroker.ts src/broker/ibkr/IBKRBroker.test.ts
git commit -m "feat: enrich portfolio positions with IB market hours"
```

### Task 3: Render open/closed status and countdown in the portfolio table

**Files:**
- Modify: `src/tui/PortfolioView.tsx`
- Modify: `src/tui/PortfolioView.test.tsx`
- Use: `src/marketHours/session.ts`

**Step 1: Write the failing test**

```ts
it("renders OPEN and countdown to close", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
  mockUseStore.mockImplementation((selector) => {
    const state = {
      positions: [
        createMockPosition({
          marketHours: {
            timeZoneId: "America/New_York",
            liquidHours: "20260210:0930-1600;20260211:0930-1600",
            tradingHours: null,
          },
        }),
      ],
      totalEquity: 15050,
      cashBalance: 0,
      subscribePortfolio: mockSubscribe,
      initialLoadComplete: true,
      lastPortfolioUpdateAt: Date.now(),
    };
    return selector ? selector(state as never) : state;
  });

  const { lastFrame } = render(<PortfolioView />);
  const frame = lastFrame();
  expect(frame).toContain("OPEN");
  expect(frame).toContain("6h 0m to close");
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tui/PortfolioView.test.tsx -t "renders OPEN and countdown to close"`
Expected: FAIL because status/countdown columns are not rendered yet.

**Step 3: Write minimal implementation**

```tsx
import { resolveMarketSession, formatSessionCountdown } from "../marketHours/session.js";

const COLUMNS = {
  ticker: 8,
  quantity: 10,
  price: 12,
  avgCost: 12,
  unrealizedPnL: 14,
  portfolioPct: 10,
  marketState: 8,
  nextTransition: 18,
  marketValue: 14,
};

const HeaderRow: React.FC = () => (
  <Box>
    <Text color="cyan" bold>
      {padRight("Ticker", COLUMNS.ticker)}
      {padLeft("Qty", COLUMNS.quantity)}
      {padLeft("Price", COLUMNS.price)}
      {padLeft("Avg Cost", COLUMNS.avgCost)}
      {padLeft("Unrealized", COLUMNS.unrealizedPnL)}
      {padLeft("% Port", COLUMNS.portfolioPct)}
      {padLeft("Mkt", COLUMNS.marketState)}
      {padLeft("Next", COLUMNS.nextTransition)}
      {padLeft("Mkt Value", COLUMNS.marketValue)}
    </Text>
  </Box>
);

const PositionRow: React.FC<{ position: Position; totalValue: number; nowMs: number }> = ({
  position,
  totalValue,
  nowMs,
}) => {
  const portfolioPct = totalValue > 0 ? (position.marketValue / totalValue) * 100 : 0;
  const session = resolveMarketSession(position.marketHours, nowMs);
  const marketLabel = session.status === "open" ? "OPEN" : session.status === "closed" ? "CLOSED" : "--";
  const marketColor = session.status === "open" ? "green" : session.status === "closed" ? "yellow" : undefined;
  const nextLabel = formatSessionCountdown(session);

  return (
    <Box>
      {/* existing columns */}
      <Text>{padLeft(formatNumber(portfolioPct, 1) + "%", COLUMNS.portfolioPct)}</Text>
      <Text color={marketColor}>{padLeft(marketLabel, COLUMNS.marketState)}</Text>
      <Text>{padLeft(nextLabel, COLUMNS.nextTransition)}</Text>
      <Text>{padLeft(formatCurrency(position.marketValue), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

export const PortfolioView: React.FC = () => {
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // when mapping rows:
  // <PositionRow key={position.conId} position={position} totalValue={totalEquity} nowMs={nowMs} />
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/tui/PortfolioView.test.tsx`
Expected: PASS for all existing tests plus new open/closed countdown coverage.

**Step 5: Commit**

```bash
git add src/tui/PortfolioView.tsx src/tui/PortfolioView.test.tsx
git commit -m "feat: show market open/closed state and session countdown"
```

### Task 4: Cover timezone alias edge cases and multi-market behavior

**Files:**
- Modify: `src/marketHours/session.ts`
- Modify: `src/marketHours/session.test.ts`
- Modify: `src/tui/PortfolioView.test.tsx`
- Modify: `docs/ibkr-portfolio-streams.md`
- Modify: `docs/architecture.md`

**Step 1: Write the failing test**

```ts
it("maps IB EST timezone to America/New_York (DST-aware)", () => {
  const now = Date.parse("2026-07-10T15:00:00.000Z"); // 11:00 EDT, not 10:00
  const session = resolveMarketSession(
    {
      timeZoneId: "EST",
      liquidHours: "20260710:0930-1600;20260713:0930-1600",
      tradingHours: null,
    },
    now
  );

  expect(session.status).toBe("open");
  expect(formatSessionCountdown(session)).toBe("5h 0m to close");
});

it("renders different status/countdown for different asset markets at same UTC time", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
  // position A: New York schedule -> OPEN
  // position B: Tokyo schedule -> CLOSED
  // assert frame contains both OPEN and CLOSED plus both countdown strings.
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/marketHours/session.test.ts src/tui/PortfolioView.test.tsx`
Expected: FAIL because timezone alias normalization and multi-market expectations are not fully enforced yet.

**Step 3: Write minimal implementation**

```ts
const IB_TZ_ALIASES: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  JST: "Asia/Tokyo",
  HKT: "Asia/Hong_Kong",
};

const normalizeTimeZone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  return IB_TZ_ALIASES[raw] ?? raw;
};

// Use normalizeTimeZone() before Intl.DateTimeFormat and return unknown if invalid timezone.
```

Update docs:
- Add `reqContractDetails` to stream inventory and describe position-level market-hours enrichment.
- Document new UI columns and behavior (`Mkt`, `Next`, open/closed + countdown).

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/marketHours/session.test.ts src/tui/PortfolioView.test.tsx src/broker/ibkr/IBKRBroker.test.ts`
Expected: PASS for timezone aliases, mixed-market rendering, and broker enrichment.

**Step 5: Commit**

```bash
git add src/marketHours/session.ts src/marketHours/session.test.ts src/tui/PortfolioView.test.tsx docs/ibkr-portfolio-streams.md docs/architecture.md
git commit -m "feat: support IB timezone aliases and document market-session flow"
```

## Final Verification

1. Run: `npm run test`  
Expected: PASS

2. Run: `npm run typecheck`  
Expected: PASS

3. Run: `npm run lint`  
Expected: PASS

## Rollback Plan

- Revert last commit if UI formatting regresses.
- If broker contract-details subscription causes instability, temporarily gate enrichment behind a feature flag and keep `marketHours` optional.
- Keep session calculator pure and isolated so behavior can be validated independently.

## Completion Notes

1. Column widths were reduced from the plan's suggested values to fit within the 100-column limit of ink-testing-library's stdout mock. The `Mkt` (OPEN/CLOSED label) column was later removed in favor of color-coding the countdown text (green=open, yellow=closed). Final widths: ticker=8, quantity=8, price=10, avgCost=10, unrealizedPnL=12, portfolioPct=8, nextTransition=17, marketValue=14 (total: 87).
2. Added debug logging for `reqContractDetails` and `contractDetails` events in the broker to aid production diagnostics.
3. Timezone alias map includes 14 IB abbreviations (EST, EDT, CST, CDT, PST, PDT, JST, HKT, GMT, BST, CET, CEST, MET, MEST) mapping to IANA timezone identifiers. Invalid timezones are caught and return `"unknown"` status gracefully.
4. The `PositionMarketHours` type is defined in both `src/broker/types.ts` (canonical, used by broker/state/UI) and `src/marketHours/session.ts` (self-contained for the pure utility). These are structurally identical.
