# IBKR Broker Architecture Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

## Status

Completed on 2026-02-10.

Outcome:
- Moved market-hours calculator to `src/broker/ibkr/market-hours/resolveMarketHours.ts` with barrel export.
- Extracted `portfolioProjection`, `contractDetailsTracker`, and `createPortfolioSubscription` into `src/broker/ibkr/portfolio/`.
- `IBKRBroker.subscribePortfolio` reduced to a 4-line delegation.
- Added `src/broker/ibkr/index.ts` barrel export; updated store and docs.
- All 54 tests pass, build and lint clean.

**Goal:** Refactor `src/broker/ibkr` into cohesive modules with clear responsibilities, while preserving the `Broker` interface contract and current runtime behavior.

**Architecture:** Keep `IBKRBroker` as a thin adapter that implements `Broker`; move portfolio stream state and contract-details orchestration into small IBKR-specific modules under `src/broker/ibkr/portfolio`; keep market-hours logic inside `src/broker/ibkr` but split it into focused modules under `src/broker/ibkr/market-hours` because parsing IB schedule/timezone formats is broker-coupled.

**Tech Stack:** TypeScript (NodeNext ESM), Vitest, Ink, Zustand, `@stoqey/ib`, Node `Intl.DateTimeFormat`.

---

**Supporting Skills:** @typescript-expert

## Preconditions

- Work in a dedicated worktree.
- Keep DRY and YAGNI: no new broker capabilities, only structure and ownership changes.
- Use strict TDD for each task.
- Commit after each task.

## Target Layout

```text
src/
└── broker/
    ├── types.ts
    └── ibkr/
        ├── IBKRBroker.ts
        ├── index.ts
        ├── market-hours/
        │   ├── resolveMarketHours.ts
        │   ├── resolveMarketHours.test.ts
        │   └── index.ts
        └── portfolio/
            ├── createPortfolioSubscription.ts
            ├── portfolioProjection.ts
            ├── contractDetailsTracker.ts
            └── types.ts
```

## Extraction Decisions

1. Extract now (within `ibkr/`): market-hours parser/countdown into smaller modules under `src/broker/ibkr/market-hours`.
2. Keep in IBKR modules: account-scoping, request-id tracking, contract-details mapping (IBKR protocol specific).
3. Defer extraction: `PortfolioView` table-format helpers (`padLeft`, `padRight`, `formatCurrency`) because they are UI-local and single-consumer.
4. Defer cross-broker utility extraction for market-hours until a second broker shares the same schedule model.

### Task 1: Refactor market-hours into IBKR-scoped submodules

**Files:**
- Create: `src/broker/ibkr/market-hours/resolveMarketHours.ts`
- Create: `src/broker/ibkr/market-hours/resolveMarketHours.test.ts`
- Create: `src/broker/ibkr/market-hours/index.ts`
- Modify: `src/tui/PortfolioView.tsx`
- Delete: `src/broker/ibkr/marketHours.ts`
- Delete: `src/broker/ibkr/marketHours.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveMarketHours, formatMarketHoursCountdown } from "./resolveMarketHours.js";

describe("resolveMarketHours", () => {
  it("returns OPEN and time-to-close for US equity hours", () => {
    const now = Date.parse("2026-02-10T15:00:00.000Z");
    const session = resolveMarketHours(
      {
        timeZoneId: "America/New_York",
        liquidHours: "20260210:0930-1600;20260211:0930-1600",
        tradingHours: null,
      },
      now
    );

    expect(session.status).toBe("open");
    expect(formatMarketHoursCountdown(session)).toBe("6h 0m to close");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/market-hours/resolveMarketHours.test.ts`
Expected: FAIL with module-not-found for `src/broker/ibkr/market-hours/resolveMarketHours.ts`.

**Step 3: Write minimal implementation**

```ts
// src/broker/ibkr/market-hours/resolveMarketHours.ts
import type { PositionMarketHours } from "../../types.js";

export type MarketHoursState = "open" | "closed" | "unknown";

export type MarketHoursStatus = {
  status: MarketHoursState;
  minutesToNextTransition: number | null;
  transition: "open" | "close" | null;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };
type Window = { startKey: number; endKey: number };

const IB_TZ_ALIASES: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  JST: "Asia/Tokyo",
  HKT: "Asia/Hong_Kong",
  GMT: "Europe/London",
  BST: "Europe/London",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  MET: "Europe/Berlin",
  MEST: "Europe/Berlin",
};

const normalizeTimeZone = (raw: string): string => IB_TZ_ALIASES[raw] ?? raw;

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

  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
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

const parseDateTimeToken = (token: string): [string, string] | null => {
  if (!token.includes(":")) return null;
  const colonIdx = token.indexOf(":");
  return [token.slice(0, colonIdx), token.slice(colonIdx + 1)];
};

const parseIbHours = (hours: string): Window[] => {
  const windows: Window[] = [];
  for (const segment of hours.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) continue;
    const day = trimmed.slice(0, firstColon);
    const remainder = trimmed.slice(firstColon + 1);
    if (!day || !remainder || remainder === "CLOSED") continue;

    for (const rawRange of remainder.split(",")) {
      const dashIdx = rawRange.indexOf("-");
      if (dashIdx === -1) continue;
      const startPart = rawRange.slice(0, dashIdx);
      const endPart = rawRange.slice(dashIdx + 1);
      if (!startPart || !endPart) continue;

      const startParsed = parseDateTimeToken(startPart);
      const endParsed = parseDateTimeToken(endPart);
      const startDate = startParsed ? startParsed[0] : day;
      const startTime = startParsed ? startParsed[1] : startPart;
      const endDate = endParsed ? endParsed[0] : day;
      const endTime = endParsed ? endParsed[1] : endPart;
      const startKey = toMinuteKey(parseDate(startDate, startTime));
      const endKey = toMinuteKey(parseDate(endDate, endTime));
      if (endKey > startKey) windows.push({ startKey, endKey });
    }
  }
  return windows.sort((a, b) => a.startKey - b.startKey);
};

export const resolveMarketHours = (
  marketHours: PositionMarketHours | null | undefined,
  nowMs = Date.now()
): MarketHoursStatus => {
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
  const timeZone = normalizeTimeZone(marketHours.timeZoneId);
  let nowKey: number;
  try {
    nowKey = toMinuteKey(toLocalParts(nowMs, timeZone));
  } catch {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }
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

export const formatMarketHoursCountdown = (session: MarketHoursStatus): string => {
  if (!session.transition || session.minutesToNextTransition === null) return "n/a";
  const hours = Math.floor(session.minutesToNextTransition / 60);
  const minutes = session.minutesToNextTransition % 60;
  return `${hours}h ${minutes}m to ${session.transition}`;
};
```

```ts
// src/broker/ibkr/market-hours/index.ts
export {
  resolveMarketHours,
  formatMarketHoursCountdown,
  type MarketHoursState,
  type MarketHoursStatus,
} from "./resolveMarketHours.js";
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/broker/ibkr/market-hours/resolveMarketHours.test.ts src/tui/PortfolioView.test.tsx`
Expected: PASS for all market-hours and portfolio-view tests.

**Step 5: Commit**

```bash
git add src/broker/ibkr/market-hours/resolveMarketHours.ts src/broker/ibkr/market-hours/resolveMarketHours.test.ts src/broker/ibkr/market-hours/index.ts src/tui/PortfolioView.tsx
git rm src/broker/ibkr/marketHours.ts src/broker/ibkr/marketHours.test.ts
git commit -m "refactor: split ibkr market-hours module by responsibility"
```

### Task 2: Extract pure portfolio projection state from `IBKRBroker`

**Files:**
- Create: `src/broker/ibkr/portfolio/types.ts`
- Create: `src/broker/ibkr/portfolio/portfolioProjection.ts`
- Test: `src/broker/ibkr/portfolio/portfolioProjection.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createPortfolioProjection } from "./portfolioProjection.js";

describe("createPortfolioProjection", () => {
  it("builds totalEquity from positionsMarketValue + cashBalance", () => {
    const projection = createPortfolioProjection();

    projection.applyPortfolioUpdate({
      contract: { conId: 265598, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150.5,
      marketValue: 15050,
      avgCost: 145,
      unrealizedPnL: 550,
      realizedPnL: 0,
    });
    projection.applyCashBalance("5000");

    const snapshot = projection.snapshot();
    expect(snapshot.positionsMarketValue).toBe(15050);
    expect(snapshot.cashBalance).toBe(5000);
    expect(snapshot.totalEquity).toBe(20050);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/portfolio/portfolioProjection.test.ts`
Expected: FAIL with module-not-found for `createPortfolioProjection`.

**Step 3: Write minimal implementation**

```ts
// src/broker/ibkr/portfolio/types.ts
import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";

export type PortfolioContract = {
  conId?: number;
  symbol?: string;
  currency?: string;
};

export type PortfolioUpdateEvent = {
  contract: PortfolioContract;
  pos: number;
  marketPrice: number;
  marketValue: number;
  avgCost?: number;
  unrealizedPnL?: number;
  realizedPnL?: number;
};

export type PortfolioProjection = {
  applyPortfolioUpdate(event: PortfolioUpdateEvent): void;
  applyCashBalance(value: string): void;
  markInitialLoadComplete(): void;
  attachMarketHours(conId: number, marketHours: PositionMarketHours): void;
  snapshot(): PortfolioUpdate;
};

export type PortfolioState = {
  positions: Map<number, Position>;
  positionsMarketValue: number;
  cashBalance: number;
  initialLoadComplete: boolean;
  lastPortfolioUpdateAt: number;
};
```

```ts
// src/broker/ibkr/portfolio/portfolioProjection.ts
import type { Position, PositionMarketHours, PortfolioUpdate } from "../../types.js";
import type { PortfolioProjection, PortfolioState, PortfolioUpdateEvent } from "./types.js";

const recomputeMarketValue = (positions: Map<number, Position>): number =>
  Array.from(positions.values()).reduce((sum, p) => sum + p.marketValue, 0);

export const createPortfolioProjection = (now = () => Date.now()): PortfolioProjection => {
  const state: PortfolioState = {
    positions: new Map<number, Position>(),
    positionsMarketValue: 0,
    cashBalance: 0,
    initialLoadComplete: false,
    lastPortfolioUpdateAt: now(),
  };

  const snapshot = (): PortfolioUpdate => ({
    positions: Array.from(state.positions.values()),
    positionsMarketValue: state.positionsMarketValue,
    cashBalance: state.cashBalance,
    totalEquity: state.positionsMarketValue + state.cashBalance,
    initialLoadComplete: state.initialLoadComplete,
    lastPortfolioUpdateAt: state.lastPortfolioUpdateAt,
  });

  const applyPortfolioUpdate = (event: PortfolioUpdateEvent): void => {
    const conId = event.contract.conId;
    if (conId === undefined || conId === null) return;
    const existing = state.positions.get(conId);
    if (event.pos === 0) {
      state.positions.delete(conId);
    } else {
      state.positions.set(conId, {
        symbol: event.contract.symbol ?? "",
        quantity: event.pos,
        avgCost: event.avgCost ?? 0,
        marketValue: event.marketValue,
        unrealizedPnL: event.unrealizedPnL ?? existing?.unrealizedPnL ?? 0,
        dailyPnL: 0,
        realizedPnL: event.realizedPnL ?? existing?.realizedPnL ?? 0,
        marketPrice: event.marketPrice,
        currency: event.contract.currency ?? "USD",
        conId,
        marketHours: existing?.marketHours,
      });
    }
    state.positionsMarketValue = recomputeMarketValue(state.positions);
    state.lastPortfolioUpdateAt = now();
  };

  const applyCashBalance = (value: string): void => {
    state.cashBalance = Number.parseFloat(value) || 0;
    state.lastPortfolioUpdateAt = now();
  };

  const markInitialLoadComplete = (): void => {
    state.initialLoadComplete = true;
    state.lastPortfolioUpdateAt = now();
  };

  const attachMarketHours = (conId: number, marketHours: PositionMarketHours): void => {
    const existing = state.positions.get(conId);
    if (!existing) return;
    state.positions.set(conId, { ...existing, marketHours });
    state.lastPortfolioUpdateAt = now();
  };

  return { applyPortfolioUpdate, applyCashBalance, markInitialLoadComplete, attachMarketHours, snapshot };
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/broker/ibkr/portfolio/portfolioProjection.test.ts`
Expected: PASS for new projection tests.

**Step 5: Commit**

```bash
git add src/broker/ibkr/portfolio/types.ts src/broker/ibkr/portfolio/portfolioProjection.ts src/broker/ibkr/portfolio/portfolioProjection.test.ts
git commit -m "refactor: extract pure ibkr portfolio projection state"
```

### Task 3: Extract contract-details request/correlation tracker

**Files:**
- Create: `src/broker/ibkr/portfolio/contractDetailsTracker.ts`
- Test: `src/broker/ibkr/portfolio/contractDetailsTracker.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createContractDetailsTracker } from "./contractDetailsTracker.js";

describe("createContractDetailsTracker", () => {
  it("requests contract details once per conId", () => {
    const tracker = createContractDetailsTracker(90_000);
    const first = tracker.nextRequest({
      conId: 265598,
      symbol: "AAPL",
      currency: "USD",
      exchange: "SMART",
      secType: "STK",
    });
    const second = tracker.nextRequest({
      conId: 265598,
      symbol: "AAPL",
      currency: "USD",
      exchange: "SMART",
      secType: "STK",
    });

    expect(first?.reqId).toBe(90_000);
    expect(second).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/portfolio/contractDetailsTracker.test.ts`
Expected: FAIL with module-not-found for `createContractDetailsTracker`.

**Step 3: Write minimal implementation**

```ts
// src/broker/ibkr/portfolio/contractDetailsTracker.ts
import type { PositionMarketHours } from "../../types.js";

type ContractSeed = {
  conId?: number;
  symbol?: string;
  currency?: string;
  exchange?: string;
  secType?: string;
};

type DetailsPayload = {
  contract?: { conId?: number };
  timeZoneId?: string;
  liquidHours?: string;
  tradingHours?: string;
};

export type ContractDetailsRequest = {
  reqId: number;
  contract: {
    conId: number;
    symbol?: string;
    currency?: string;
    exchange?: string;
    secType?: string;
  };
};

export type ContractDetailsHit = {
  conId: number;
  marketHours: PositionMarketHours;
};

export const createContractDetailsTracker = (startReqId = 90_000) => {
  const marketHoursByConId = new Map<number, PositionMarketHours>();
  const reqIdToConId = new Map<number, number>();
  const pendingConIds = new Set<number>();
  let nextReqId = startReqId;

  const nextRequest = (contract: ContractSeed): ContractDetailsRequest | null => {
    const conId = contract.conId;
    if (conId === undefined || conId === null) return null;
    if (marketHoursByConId.has(conId) || pendingConIds.has(conId)) return null;
    const reqId = nextReqId++;
    reqIdToConId.set(reqId, conId);
    pendingConIds.add(conId);
    return {
      reqId,
      contract: {
        conId,
        symbol: contract.symbol,
        currency: contract.currency,
        exchange: contract.exchange ?? "SMART",
        secType: contract.secType,
      },
    };
  };

  const onContractDetails = (reqId: number, details: DetailsPayload): ContractDetailsHit | null => {
    const conId = reqIdToConId.get(reqId) ?? details.contract?.conId;
    if (!conId) return null;
    const marketHours: PositionMarketHours = {
      timeZoneId: details.timeZoneId ?? null,
      liquidHours: details.liquidHours ?? null,
      tradingHours: details.tradingHours ?? null,
    };
    marketHoursByConId.set(conId, marketHours);
    return { conId, marketHours };
  };

  const onContractDetailsEnd = (reqId: number): void => {
    const conId = reqIdToConId.get(reqId);
    if (conId) pendingConIds.delete(conId);
    reqIdToConId.delete(reqId);
  };

  return { nextRequest, onContractDetails, onContractDetailsEnd };
};
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/broker/ibkr/portfolio/contractDetailsTracker.test.ts`
Expected: PASS for request dedupe and details-correlation tests.

**Step 5: Commit**

```bash
git add src/broker/ibkr/portfolio/contractDetailsTracker.ts src/broker/ibkr/portfolio/contractDetailsTracker.test.ts
git commit -m "refactor: extract ibkr contract details tracker"
```

### Task 4: Move portfolio event wiring into `createPortfolioSubscription`

**Files:**
- Create: `src/broker/ibkr/portfolio/createPortfolioSubscription.ts`
- Test: `src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`
- Modify: `src/broker/ibkr/IBKRBroker.ts`
- Modify: `src/broker/ibkr/IBKRBroker.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import EventEmitter from "events";
import { createPortfolioSubscription } from "./createPortfolioSubscription.js";

it("subscribes and unsubscribes account updates", () => {
  const api = Object.assign(new EventEmitter(), {
    reqAccountUpdates: vi.fn(),
    reqContractDetails: vi.fn(),
    removeListener: EventEmitter.prototype.removeListener,
  });
  const callback = vi.fn();

  const unsubscribe = createPortfolioSubscription({
    api,
    accountId: "DU123456",
    callback,
  });

  expect(api.reqAccountUpdates).toHaveBeenCalledWith(true, "DU123456");
  unsubscribe();
  expect(api.reqAccountUpdates).toHaveBeenCalledWith(false, "DU123456");
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`
Expected: FAIL with module-not-found for `createPortfolioSubscription`.

**Step 3: Write minimal implementation**

```ts
// src/broker/ibkr/portfolio/createPortfolioSubscription.ts
import { EventName } from "@stoqey/ib";
import type { PortfolioUpdate } from "../../types.js";
import { createPortfolioProjection } from "./portfolioProjection.js";
import { createContractDetailsTracker } from "./contractDetailsTracker.js";

type ApiLike = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
  reqAccountUpdates: (subscribe: boolean, accountId: string) => void;
  reqContractDetails: (reqId: number, contract: unknown) => void;
};

type Params = {
  api: ApiLike;
  accountId: string;
  callback: (update: PortfolioUpdate) => void;
  now?: () => number;
};

export const createPortfolioSubscription = ({ api, accountId, callback, now = () => Date.now() }: Params): (() => void) => {
  const projection = createPortfolioProjection(now);
  const tracker = createContractDetailsTracker();

  const emit = () => callback(projection.snapshot());
  const accountMatches = (name?: string) => !accountId || name === accountId;

  const onPortfolioUpdate = (
    contract: { conId?: number; symbol?: string; currency?: string; exchange?: string; secType?: string },
    pos: number,
    marketPrice: number,
    marketValue: number,
    avgCost?: number,
    unrealizedPnL?: number,
    realizedPnL?: number,
    accountName?: string
  ) => {
    if (!accountMatches(accountName)) return;
    projection.applyPortfolioUpdate({ contract, pos, marketPrice, marketValue, avgCost, unrealizedPnL, realizedPnL });
    const req = tracker.nextRequest(contract);
    if (req) api.reqContractDetails(req.reqId, req.contract);
    emit();
  };

  const onAccountValue = (key: string, value: string, currency: string, accountName: string) => {
    if (!accountMatches(accountName)) return;
    if (key !== "TotalCashBalance" || currency !== "BASE") return;
    projection.applyCashBalance(value);
    emit();
  };

  const onAccountDownloadEnd = (accountName: string) => {
    if (!accountMatches(accountName)) return;
    projection.markInitialLoadComplete();
    emit();
  };

  const onContractDetails = (
    reqId: number,
    details: { contract?: { conId?: number }; timeZoneId?: string; liquidHours?: string; tradingHours?: string }
  ) => {
    const hit = tracker.onContractDetails(reqId, details);
    if (!hit) return;
    projection.attachMarketHours(hit.conId, hit.marketHours);
    emit();
  };

  const onContractDetailsEnd = (reqId: number) => tracker.onContractDetailsEnd(reqId);

  api.on(EventName.updatePortfolio, onPortfolioUpdate);
  api.on(EventName.updateAccountValue, onAccountValue);
  api.on(EventName.accountDownloadEnd, onAccountDownloadEnd);
  api.on(EventName.contractDetails, onContractDetails);
  api.on(EventName.contractDetailsEnd, onContractDetailsEnd);

  api.reqAccountUpdates(true, accountId);

  return () => {
    api.removeListener(EventName.updatePortfolio, onPortfolioUpdate);
    api.removeListener(EventName.updateAccountValue, onAccountValue);
    api.removeListener(EventName.accountDownloadEnd, onAccountDownloadEnd);
    api.removeListener(EventName.contractDetails, onContractDetails);
    api.removeListener(EventName.contractDetailsEnd, onContractDetailsEnd);
    api.reqAccountUpdates(false, accountId);
  };
};
```

```ts
// src/broker/ibkr/IBKRBroker.ts (replace subscribePortfolio body)
import { createPortfolioSubscription } from "./portfolio/createPortfolioSubscription.js";

subscribePortfolio(callback: (update: PortfolioUpdate) => void): () => void {
  if (!this.api) throw new Error("Not connected");
  return createPortfolioSubscription({
    api: this.api as never,
    accountId: this.accountId,
    callback,
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts src/broker/ibkr/IBKRBroker.test.ts`
Expected: PASS for new subscription module tests and existing broker integration tests.

**Step 5: Commit**

```bash
git add src/broker/ibkr/portfolio/createPortfolioSubscription.ts src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts src/broker/ibkr/IBKRBroker.ts src/broker/ibkr/IBKRBroker.test.ts
git commit -m "refactor: extract ibkr portfolio subscription orchestration"
```

### Task 5: Finalize folder structure, public exports, and docs

**Files:**
- Create: `src/broker/ibkr/index.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/store.test.ts`
- Modify: `docs/architecture.md`
- Modify: `docs/features/market-hours.md`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { IBKRBroker } from "./index.js";

describe("broker/ibkr public exports", () => {
  it("exports IBKRBroker from index", () => {
    expect(typeof IBKRBroker).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/index.test.ts`
Expected: FAIL with module-not-found for `src/broker/ibkr/index.ts`.

**Step 3: Write minimal implementation**

```ts
// src/broker/ibkr/index.ts
export { IBKRBroker } from "./IBKRBroker.js";
```

```ts
// src/state/store.ts
import { IBKRBroker } from "../broker/ibkr/index.js";
```

```ts
// src/state/store.test.ts
vi.mock("../broker/ibkr/index.js", () => {
  return {
    IBKRBroker: vi.fn().mockImplementation(() => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn(),
      onDisconnect: vi.fn(),
      subscribePortfolio: vi.fn(),
      getAccountSummary: vi.fn(),
      getPositions: vi.fn(),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
      getOpenOrders: vi.fn(),
      subscribeQuote: vi.fn(),
    })),
  };
});
```

Also update docs to reflect:
1. market-hours stays IBKR-scoped at `src/broker/ibkr/market-hours/resolveMarketHours.ts`.
2. `IBKRBroker.ts` is now a thin adapter delegating subscription logic to `src/broker/ibkr/portfolio/createPortfolioSubscription.ts`.

**Step 4: Run test and quality suite**

Run: `npm run test`
Expected: PASS for all tests.

Run: `npm run typecheck`
Expected: PASS with no type errors.

Run: `npm run lint`
Expected: PASS with no lint violations.

**Step 5: Commit**

```bash
git add src/broker/ibkr/index.ts src/state/store.ts src/state/store.test.ts docs/architecture.md docs/features/market-hours.md
git commit -m "refactor: finalize ibkr module boundaries and public exports"
```

## Final Validation Checklist

1. `IBKRBroker` still satisfies `Broker` without interface changes in `src/broker/types.ts`.
2. `subscribePortfolio` behavior remains identical (account filter, cash updates, initial load, contract-details enrichment).
3. All market-hours tests pass from `src/broker/ibkr/market-hours`.
4. `src/tui/PortfolioView.tsx` imports market-hours from `src/broker/ibkr/market-hours/index.ts`.
5. `src/broker/ibkr` contains only IBKR implementation concerns (connection + portfolio stream orchestration).
6. `docs/architecture.md` and `docs/features/market-hours.md` match runtime structure.

## Completion Notes

1. The `ApiLike` type in `createPortfolioSubscription.ts` uses `any[]` for event handler params to bridge the `@stoqey/ib` EventEmitter typing without requiring the full IBApi type as a dependency.
2. `IBKRBroker.subscribePortfolio` uses `as never` to cast `this.api` to `ApiLike` since IBApi's EventEmitter signature is structurally compatible but not assignable without the cast.
3. Debug logging that was previously inline in `IBKRBroker.subscribePortfolio` was intentionally not carried into the extracted modules to keep them pure. Logging can be re-added at the orchestration layer if needed.
