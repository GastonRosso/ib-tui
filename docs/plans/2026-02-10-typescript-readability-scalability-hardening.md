# TypeScript Readability & Scalability Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the current TypeScript and linting weak spots (coverage gaps, weak IB boundary typing, duplicated unions, and non-scalable store consumption) while keeping behavior unchanged.

**Architecture:** Keep domain contracts centralized at module boundaries and keep implementation-only shapes local. Strengthen static analysis in two layers: compiler coverage (`typecheck`) and type-aware linting (`eslint`). Refactors are constrained to structure and typing, with behavior locked by existing tests plus small new guard tests.

**Tech Stack:** TypeScript 5.9, ESLint 8 + `@typescript-eslint`, Vitest, Ink, Zustand.

---

### Task 1: Close Static Analysis Coverage Gaps (`scripts/`)

**Files:**
- Create: `/Users/gastonrosso/Projects/ib/src/tooling/staticAnalysisCoverage.test.ts`
- Create: `/Users/gastonrosso/Projects/ib/tsconfig.typecheck.json`
- Modify: `/Users/gastonrosso/Projects/ib/package.json`
- Test: `/Users/gastonrosso/Projects/ib/src/tooling/staticAnalysisCoverage.test.ts`

**Step 1: Write the failing test**

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("static analysis coverage", () => {
  it("typecheck script targets tsconfig.typecheck.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.typecheck).toContain("tsconfig.typecheck.json");
  });

  it("lint script includes scripts directory", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.scripts.lint).toContain("scripts/");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/tooling/staticAnalysisCoverage.test.ts`
Expected: FAIL because `typecheck` still points to `tsc --noEmit` and `lint` does not include `scripts/`.

**Step 3: Write minimal implementation**

```json
// /Users/gastonrosso/Projects/ib/tsconfig.typecheck.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*", "scripts/**/*", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

```json
// /Users/gastonrosso/Projects/ib/package.json (scripts section)
{
  "scripts": {
    "lint": "eslint src/ scripts/",
    "lint:fix": "eslint src/ scripts/ --fix",
    "typecheck": "tsc -p tsconfig.typecheck.json --noEmit"
  }
}
```

**Step 4: Run test to verify it passes**

Run:
- `npm run test -- src/tooling/staticAnalysisCoverage.test.ts`
- `npm run typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/src/tooling/staticAnalysisCoverage.test.ts /Users/gastonrosso/Projects/ib/tsconfig.typecheck.json /Users/gastonrosso/Projects/ib/package.json
git commit -m "chore: include scripts in lint and typecheck coverage"
```

### Task 2: Create a Typed IB Portfolio Event Boundary (Remove `any`)

**Files:**
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.ts`
- Create: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.contract.test.ts`
- Test: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  PortfolioApi,
  PortfolioContractSeed,
  ContractDetailsPayload,
} from "./types.js";

describe("portfolio type contracts", () => {
  it("exports IB boundary types", () => {
    expectTypeOf<PortfolioApi>().toMatchTypeOf<{
      reqAccountUpdates(subscribe: boolean, accountId: string): void;
      reqContractDetails(reqId: number, contract: PortfolioContractSeed): void;
    }>();

    expectTypeOf<ContractDetailsPayload>().toMatchTypeOf<{
      contract?: { conId?: number };
      timeZoneId?: string;
      liquidHours?: string;
      tradingHours?: string;
    }>();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/broker/ibkr/portfolio/types.contract.test.ts`
Expected: FAIL because these types are not exported yet.

**Step 3: Write minimal implementation**

```ts
// /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.ts
export type PortfolioContractSeed = {
  conId?: number;
  symbol?: string;
  currency?: string;
  exchange?: string;
  secType?: string;
};

export type ContractDetailsPayload = {
  contract?: { conId?: number };
  timeZoneId?: string;
  liquidHours?: string;
  tradingHours?: string;
};

export type PortfolioEventMap = {
  updatePortfolio: [
    contract: PortfolioContractSeed,
    pos: number,
    marketPrice: number,
    marketValue: number,
    avgCost?: number,
    unrealizedPnL?: number,
    realizedPnL?: number,
    accountName?: string
  ];
  updateAccountValue: [key: string, value: string, currency: string, accountName: string];
  accountDownloadEnd: [accountName: string];
  contractDetails: [reqId: number, details: ContractDetailsPayload];
  contractDetailsEnd: [reqId: number];
};

export type PortfolioApi = {
  on<E extends keyof PortfolioEventMap>(
    event: E,
    handler: (...args: PortfolioEventMap[E]) => void
  ): void;
  removeListener<E extends keyof PortfolioEventMap>(
    event: E,
    handler: (...args: PortfolioEventMap[E]) => void
  ): void;
  reqAccountUpdates(subscribe: boolean, accountId: string): void;
  reqContractDetails(reqId: number, contract: PortfolioContractSeed): void;
};
```

Then update imports/usages in:
- `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts`
- `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.ts`

and remove:
- `eslint-disable` lines for `no-explicit-any`
- inline duplicate payload declarations.

**Step 4: Run test to verify it passes**

Run:
- `npm run test -- src/broker/ibkr/portfolio/types.contract.test.ts`
- `npm run test -- src/broker/ibkr/portfolio/createPortfolioSubscription.test.ts`
- `npm run typecheck`
Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/types.contract.test.ts
git commit -m "refactor: add typed IB portfolio event boundary"
```

### Task 3: Enable Type-Aware ESLint Rules and Fix Violations

**Files:**
- Create: `/Users/gastonrosso/Projects/ib/tsconfig.eslint.json`
- Modify: `/Users/gastonrosso/Projects/ib/eslint.config.js`
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/App.tsx`
- Modify: `/Users/gastonrosso/Projects/ib/src/index.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.test.ts`

**Step 1: Write the failing test**

```js
// /Users/gastonrosso/Projects/ib/eslint.config.js (rules to add)
"@typescript-eslint/no-floating-promises": "error",
"@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
"@typescript-eslint/no-non-null-assertion": "error",
"@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
"@typescript-eslint/no-explicit-any": "error"
```

and enable typed linting with:

```json
// /Users/gastonrosso/Projects/ib/tsconfig.eslint.json
{
  "extends": "./tsconfig.typecheck.json",
  "include": ["src/**/*", "scripts/**/*", "vitest.config.ts"]
}
```

**Step 2: Run test to verify it fails**

Run: `npm run lint`
Expected: FAIL on current code (`this.api!`, floating promises in UI entry points, and any remaining explicit `any`).

**Step 3: Write minimal implementation**

```ts
// /Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts
const api = new IBApi({ host: config.host, port: config.port });
this.api = api;
this.setupEventHandlers();

return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Connection timeout")), 10_000);
  api.once(EventName.nextValidId, () => {
    clearTimeout(timeout);
    resolve();
  });
  api.connect(config.clientId);
});
```

```ts
// /Users/gastonrosso/Projects/ib/src/tui/App.tsx
if (input === "q" || (key.ctrl && input === "c")) {
  void disconnect().finally(() => exit());
}
if (input === "c" && (connectionStatus === "disconnected" || connectionStatus === "error")) {
  void connect();
}
```

```ts
// /Users/gastonrosso/Projects/ib/src/index.ts
void waitUntilExit().then(() => {
  process.exit(0);
});
```

```ts
// /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.test.ts
expect(req).toBeDefined();
if (!req) throw new Error("expected request");
tracker.onContractDetails(req.reqId, { ... });
tracker.onContractDetailsEnd(req.reqId);
```

**Step 4: Run test to verify it passes**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test -- src/broker/ibkr/IBKRBroker.test.ts src/broker/ibkr/portfolio/contractDetailsTracker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/eslint.config.js /Users/gastonrosso/Projects/ib/tsconfig.eslint.json /Users/gastonrosso/Projects/ib/src/tui/App.tsx /Users/gastonrosso/Projects/ib/src/index.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/IBKRBroker.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/contractDetailsTracker.test.ts
git commit -m "chore: enable typed eslint rules and resolve violations"
```

### Task 4: Consolidate Shared Primitive Types (`LogLevel`, `ConnectionStatus`)

**Files:**
- Create: `/Users/gastonrosso/Projects/ib/src/state/types.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/state/store.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/App.tsx`
- Modify: `/Users/gastonrosso/Projects/ib/src/utils/logger.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/index.ts`
- Modify: `/Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts`
- Create: `/Users/gastonrosso/Projects/ib/src/state/types.contract.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { ConnectionStatus } from "./types.js";
import { LOG_LEVELS, type LogLevel } from "../utils/logger.js";

describe("shared primitive contracts", () => {
  it("exports strict connection statuses and log levels", () => {
    expectTypeOf<ConnectionStatus>().toEqualTypeOf<
      "disconnected" | "connecting" | "connected" | "error"
    >();

    expectTypeOf<LogLevel>().toEqualTypeOf<(typeof LOG_LEVELS)[number]>();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- src/state/types.contract.test.ts`
Expected: FAIL because `src/state/types.ts` and `LOG_LEVELS` export do not exist yet.

**Step 3: Write minimal implementation**

```ts
// /Users/gastonrosso/Projects/ib/src/state/types.ts
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
```

```ts
// /Users/gastonrosso/Projects/ib/src/utils/logger.ts
export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
```

```ts
// /Users/gastonrosso/Projects/ib/src/tui/App.tsx
import type { ConnectionStatus } from "../state/types.js";
const StatusIndicator: React.FC<{ status: ConnectionStatus }> = ({ status }) => { ... };
```

```ts
// /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts
import type { LogLevel } from "../../../utils/logger.js";
type LogFn = (level: LogLevel, stream: string, detail: string) => void;
```

```ts
// /Users/gastonrosso/Projects/ib/src/index.ts
import { LOG_LEVELS, type LogLevel } from "./utils/logger.js";
const VALID_LEVELS = [...LOG_LEVELS];
const isLogLevel = (value: string): value is LogLevel =>
  LOG_LEVELS.includes(value as LogLevel);
```

**Step 4: Run test to verify it passes**

Run:
- `npm run test -- src/state/types.contract.test.ts`
- `npm run typecheck`
- `npm run lint`
Expected: PASS.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/src/state/types.ts /Users/gastonrosso/Projects/ib/src/state/store.ts /Users/gastonrosso/Projects/ib/src/tui/App.tsx /Users/gastonrosso/Projects/ib/src/utils/logger.ts /Users/gastonrosso/Projects/ib/src/index.ts /Users/gastonrosso/Projects/ib/src/broker/ibkr/portfolio/createPortfolioSubscription.ts /Users/gastonrosso/Projects/ib/src/state/types.contract.test.ts
git commit -m "refactor: centralize connection and log level primitives"
```

### Task 5: Refactor Zustand Consumption to Selector-Based Access

**Files:**
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/App.tsx`
- Modify: `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx`
- Test: `/Users/gastonrosso/Projects/ib/src/tui/PortfolioView.test.tsx`

**Step 1: Write the failing test**

Use a grep gate so broad store subscriptions cannot regress:

Run: `rg -n "useStore\(\)" src/tui/App.tsx src/tui/PortfolioView.tsx`
Expected: FAIL gate (matches found).

**Step 2: Run baseline tests before refactor**

Run: `npm run test -- src/tui/PortfolioView.test.tsx`
Expected: PASS baseline.

**Step 3: Write minimal implementation**

```ts
// /Users/gastonrosso/Projects/ib/src/tui/App.tsx
const connectionStatus = useStore((s) => s.connectionStatus);
const connect = useStore((s) => s.connect);
const disconnect = useStore((s) => s.disconnect);
const error = useStore((s) => s.error);
```

```ts
// /Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx
const positions = useStore((s) => s.positions);
const totalEquity = useStore((s) => s.totalEquity);
const cashBalance = useStore((s) => s.cashBalance);
const subscribePortfolio = useStore((s) => s.subscribePortfolio);
const initialLoadComplete = useStore((s) => s.initialLoadComplete);
const lastPortfolioUpdateAt = useStore((s) => s.lastPortfolioUpdateAt);
```

**Step 4: Run tests to verify it passes**

Run:
- `rg -n "useStore\(\)" src/tui/App.tsx src/tui/PortfolioView.tsx`
- `npm run test -- src/tui/PortfolioView.test.tsx`
- `npm run lint`
Expected: first command returns no matches; tests/lint PASS.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/src/tui/App.tsx /Users/gastonrosso/Projects/ib/src/tui/PortfolioView.tsx /Users/gastonrosso/Projects/ib/src/tui/PortfolioView.test.tsx
git commit -m "refactor: use selector-based zustand subscriptions in UI"
```

### Task 6: Final Verification + Documentation Notes

**Files:**
- Modify: `/Users/gastonrosso/Projects/ib/docs/architecture.md`
- Modify: `/Users/gastonrosso/Projects/ib/docs/plans/2026-02-10-typescript-readability-scalability-hardening.md` (completion notes at end)

**Step 1: Write the failing test**

Run full quality gates and treat any failure as block:

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
Expected: If any command fails, stop and fix before documenting.

**Step 2: Run gate to capture current status**

Run the three commands above and record outputs in your scratch notes.
Expected: PASS after Tasks 1-5.

**Step 3: Write minimal implementation**

Add a concise section to `/Users/gastonrosso/Projects/ib/docs/architecture.md` describing:
- where shared domain types live (`src/broker/types.ts`)
- where adapter-boundary IB event types live (`src/broker/ibkr/portfolio/types.ts`)
- rule: local-only implementation types stay in file scope.

Add completion notes to this plan file with commit SHAs and any deferred items.

**Step 4: Run final verification**

Run:
- `npm run lint`
- `npm run typecheck`
- `npm run test`
Expected: PASS with zero warnings/errors.

**Step 5: Commit**

```bash
git add /Users/gastonrosso/Projects/ib/docs/architecture.md /Users/gastonrosso/Projects/ib/docs/plans/2026-02-10-typescript-readability-scalability-hardening.md
git commit -m "docs: document types and lint architecture boundaries"
```

---

## Execution Guidance

- Use `@typescript-expert` for type-shape and lint-rule decisions.
- Run `@code-reviewer` after Task 5 and before Task 6 commit.
- Keep each task as a separate commit to preserve rollback granularity.
- Do not expand domain scope (YAGNI): no new runtime behavior, only typing/structure/safety.

## Status

Completed on 2026-02-10.

Outcome:
- All 6 tasks implemented as separate commits on `feature/typescript-readability-scalability-hardening`.
- Zero lint errors, zero typecheck errors, 62 tests passing.

## Completion Notes

1. `0bd26d3` — Task 1: `tsconfig.typecheck.json` covers `scripts/` and `vitest.config.ts`; lint now includes `scripts/`.
2. `cb98140` — Task 2: `PortfolioApi`, `PortfolioContractSeed`, `ContractDetailsPayload`, `PortfolioEventMap` exported from `types.ts`; removed `eslint-disable` lines and inline duplicate type declarations.
3. `372130d` — Task 3: Enabled `no-floating-promises`, `no-misused-promises`, `no-non-null-assertion`, `consistent-type-imports`, `no-explicit-any` (error); all 8 violations resolved.
4. `b92be2c` — Task 4: `ConnectionStatus` centralized in `src/state/types.ts`; `LOG_LEVELS` const array exported from `logger.ts` with `LogLevel` derived from it.
5. `b98a4b7` — Task 5: All `useStore()` calls in `App.tsx` and `PortfolioView.tsx` replaced with selector-based `useStore((s) => s.field)`.
6. No deferred items.
