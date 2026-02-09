import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

type ParsedLine = {
  lineNo: number;
  timeMs: number;
  level: string;
  stream: string;
  detail: string;
  fields: Record<string, string>;
};

type PositionState = {
  quantity: number;
  marketValue: number;
  marketPrice: number;
};

type ReplayState = {
  selectedAccount: string;
  positions: Map<number, PositionState>;
  cashBalance: number;
};

const parseFields = (detail: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([A-Za-z][A-Za-z0-9]*)=([^\s]+)/g;
  let match: RegExpExecArray | null = re.exec(detail);
  while (match) {
    out[match[1]] = match[2];
    match = re.exec(detail);
  }
  return out;
};

const parseLine = (line: string): ParsedLine | null => {
  // New format: [HH:MM:SS.mmm] LEVEL stream: detail
  const match = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+(\S+)\s+([^:]+):\s*(.*)$/);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const msec = Number(match[4]);
  const timeMs = (((hh * 60) + mm) * 60 + ss) * 1000 + msec;
  const level = match[5];
  const stream = match[6];
  const detail = match[7];

  return {
    lineNo: -1,
    timeMs,
    level,
    stream,
    detail,
    fields: parseFields(detail),
  };
};

const toFiniteNumber = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sumPositions = (positions: Map<number, PositionState>): number => {
  let sum = 0;
  for (const position of positions.values()) {
    sum += position.marketValue;
  }
  return sum;
};

describe("IBKR stream log replay", () => {
  it("replays stream logs and checks account-update-only invariants", () => {
    const inputPath = process.env.IBKR_STREAM_LOG_PATH;
    if (!inputPath) {
      return;
    }

    const resolvedPath = path.resolve(process.cwd(), inputPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`IBKR_STREAM_LOG_PATH does not exist: ${resolvedPath}`);
    }

    const lines = fs
      .readFileSync(resolvedPath, "utf8")
      .split("\n")
      .map((line) => line.trimEnd());

    const createInitialState = (): ReplayState => ({
      selectedAccount: "",
      positions: new Map(),
      cashBalance: 0,
    });

    let state: ReplayState = createInitialState();
    let session = 0;

    const failures: string[] = [];
    const absTol = 0.05;

    let sawPnlSubscription = false;
    let sawPnlSingleSubscription = false;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine) continue;
      if (rawLine.startsWith("===") && rawLine.includes("log session start")) {
        session += 1;
        state = createInitialState();
        continue;
      }
      if (!rawLine.startsWith("[")) continue;

      const parsed = parseLine(rawLine);
      if (!parsed) continue;
      const line: ParsedLine = {
        ...parsed,
        lineNo: i + 1,
      };

      if (line.stream === "event.managedAccounts" && line.detail.includes("selectedAccount=")) {
        const selected = line.fields.selectedAccount;
        if (selected) state.selectedAccount = selected;
      }

      // Detect any leftover pnl/pnlSingle subscriptions (should not exist after simplification)
      if (line.stream === "subscription" && line.detail.includes("reqPnL ")) {
        sawPnlSubscription = true;
      }
      if (line.stream === "subscription" && line.detail.includes("reqPnLSingle")) {
        sawPnlSingleSubscription = true;
      }

      if (line.stream === "event.updatePortfolio" && line.detail.startsWith("received")) {
        const account = line.fields.account;
        const conId = toFiniteNumber(line.fields.conId);
        const qty = toFiniteNumber(line.fields.qty);
        const marketPrice = toFiniteNumber(line.fields.mktPrice);
        const marketValue = toFiniteNumber(line.fields.mktValue);

        if (state.selectedAccount && account && account !== state.selectedAccount) {
          continue;
        }
        if (conId === null || qty === null || marketPrice === null || marketValue === null) {
          continue;
        }

        if (qty === 0) {
          state.positions.delete(conId);
          continue;
        }

        state.positions.set(conId, {
          quantity: qty,
          marketValue,
          marketPrice,
        });
      }

      if (line.stream === "event.accountValue" && line.detail.startsWith("received")) {
        const account = line.fields.account;
        const key = line.fields.key;
        const currency = line.fields.currency;
        const value = toFiniteNumber(line.fields.value);
        if (state.selectedAccount && account && account !== state.selectedAccount) {
          continue;
        }
        if (value === null) continue;

        if (key === "TotalCashBalance" && currency === "BASE") {
          state.cashBalance = value;
        }
      }

      if (line.stream === "event.emit") {
        const emittedPositions = toFiniteNumber(line.fields.positionsMV);
        const emittedCash = toFiniteNumber(line.fields.cash);
        const emittedTotal = toFiniteNumber(line.fields.totalEquity);
        if (emittedPositions === null || emittedCash === null || emittedTotal === null) {
          continue;
        }

        const expectedPositions = sumPositions(state.positions);
        const expectedTotal = expectedPositions + state.cashBalance;

        if (Math.abs(expectedPositions - emittedPositions) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] positionsMV expected=${expectedPositions.toFixed(2)} emitted=${emittedPositions.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (Math.abs(state.cashBalance - emittedCash) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] cash expected=${state.cashBalance.toFixed(2)} emitted=${emittedCash.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (Math.abs(expectedTotal - emittedTotal) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] total expected=${expectedTotal.toFixed(2)} emitted=${emittedTotal.toFixed(2)} t=${line.timeMs}`
          );
        }
      }
    }

    // Regression: no pnl/pnlSingle subscriptions should appear in new logs
    if (sawPnlSubscription) {
      failures.push("[regression] Found reqPnL subscription in log - should not exist after simplification");
    }
    if (sawPnlSingleSubscription) {
      failures.push("[regression] Found reqPnLSingle subscription in log - should not exist after simplification");
    }

    if (failures.length > 0) {
      const maxLines = 25;
      const shown = failures.slice(0, maxLines).join("\n");
      const suffix = failures.length > maxLines ? `\n... and ${failures.length - maxLines} more` : "";
      throw new Error(`Replay found ${failures.length} issue(s):\n${shown}${suffix}`);
    }

    expect(failures).toHaveLength(0);
  });
});
