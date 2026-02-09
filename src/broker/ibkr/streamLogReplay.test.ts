import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

type ParsedLine = {
  lineNo: number;
  timeMs: number;
  stream: string;
  detail: string;
  fields: Record<string, string>;
};

type PositionState = {
  quantity: number;
  marketValue: number;
  marketPrice: number;
  pnlSingleActive: boolean;
  lastPnLSingleTickAtMs: number | null;
};

type ReplayState = {
  selectedAccount: string;
  positions: Map<number, PositionState>;
  reqIdToConId: Map<number, number>;
  cashBalance: number;
  lastNetLiquidation: number | null;
  firstUpdatePortfolioValueByConId: Map<number, number>;
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
  const match = line.match(/^\[(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s+([^:]+):\s*(.*)$/);
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const msec = Number(match[4]);
  const timeMs = (((hh * 60) + mm) * 60 + ss) * 1000 + msec;
  const stream = match[5];
  const detail = match[6];

  return {
    lineNo: -1,
    timeMs,
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
  it("replays stream logs and checks merge invariants", () => {
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
      reqIdToConId: new Map(),
      cashBalance: 0,
      lastNetLiquidation: null,
      firstUpdatePortfolioValueByConId: new Map(),
    });

    let state: ReplayState = createInitialState();
    let session = 0;

    const failures: string[] = [];
    const relDiffThreshold = Number(process.env.IBKR_STREAM_MAX_REL_DIFF ?? "0.001");
    const absTol = 0.05;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (!rawLine) continue;
      if (rawLine.startsWith("===") && rawLine.includes("debug session start")) {
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

      if (line.stream === "connection" && line.detail.includes("selectedAccount=")) {
        const selected = line.fields.selectedAccount;
        if (selected) state.selectedAccount = selected;
      }

      if (line.stream === "subscription" && line.detail.startsWith("start reqPnLSingle")) {
        const conId = toFiniteNumber(line.fields.conId);
        const reqId = toFiniteNumber(line.fields.reqId);
        if (conId !== null && reqId !== null) {
          state.reqIdToConId.set(reqId, conId);
        }
      }

      if (line.stream === "subscription" && line.detail.startsWith("cancel reqPnLSingle")) {
        const reqId = toFiniteNumber(line.fields.reqId);
        if (reqId !== null) {
          state.reqIdToConId.delete(reqId);
        }
      }

      if (line.stream === "updatePortfolio" && line.detail.startsWith("received")) {
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

        const existing = state.positions.get(conId);
        const preserveRealtime =
          existing !== undefined &&
          existing.pnlSingleActive &&
          existing.lastPnLSingleTickAtMs !== null &&
          line.timeMs - existing.lastPnLSingleTickAtMs <= 3000 &&
          existing.quantity === qty;

        if (qty === 0) {
          state.positions.delete(conId);
          continue;
        }

        const nextMarketValue = preserveRealtime ? existing.marketValue : marketValue;
        const nextMarketPrice = preserveRealtime ? existing.marketPrice : marketPrice;
        state.positions.set(conId, {
          quantity: qty,
          marketValue: nextMarketValue,
          marketPrice: nextMarketPrice,
          pnlSingleActive: preserveRealtime ? existing.pnlSingleActive : false,
          lastPnLSingleTickAtMs: preserveRealtime ? existing.lastPnLSingleTickAtMs : null,
        });

        if (!state.firstUpdatePortfolioValueByConId.has(conId)) {
          state.firstUpdatePortfolioValueByConId.set(conId, marketValue);
        }
      }

      if (line.stream === "pnlSingle" && line.detail.startsWith("received")) {
        const reqId = toFiniteNumber(line.fields.reqId);
        const pos = toFiniteNumber(line.fields.pos);
        const value = toFiniteNumber(line.fields.value);
        const unreal = toFiniteNumber(line.fields.unrealPnL);

        if (reqId === null) continue;
        const conId = state.reqIdToConId.get(reqId);
        if (conId === undefined) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [${line.stream}] unknown reqId=${reqId} at t=${line.timeMs}`
          );
          continue;
        }

        const existing = state.positions.get(conId);
        if (!existing) continue;

        existing.pnlSingleActive = true;
        existing.lastPnLSingleTickAtMs = line.timeMs;

        const quantity = pos !== null && pos !== 0 ? pos : existing.quantity;
        const validValue = value !== null && Math.abs(value) < 1e100;

        let nextValue = existing.marketValue;
        if (validValue) {
          nextValue = value;
        } else if (unreal !== null) {
          // avgCost is not present in log lines; keep current value on derived branch.
          nextValue = existing.marketValue;
        }

        existing.quantity = quantity;
        existing.marketValue = nextValue;
        if (quantity !== 0) {
          existing.marketPrice = nextValue / quantity;
        }

        const baseline = state.firstUpdatePortfolioValueByConId.get(conId);
        if (baseline !== undefined && baseline !== 0 && validValue) {
          const rel = Math.abs(nextValue - baseline) / Math.abs(baseline);
          if (rel > relDiffThreshold) {
            failures.push(
              `[session=${session} line=${line.lineNo}] [pnlSingle drift] conId=${conId} baseline=${baseline.toFixed(2)} pnlSingleValue=${nextValue.toFixed(2)} relDiff=${(rel * 100).toFixed(3)}% threshold=${(relDiffThreshold * 100).toFixed(3)}%`
            );
          }
        }
      }

      if (line.stream === "accountValue" && line.detail.startsWith("received")) {
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
        if (key === "NetLiquidation" && currency === "BASE") {
          state.lastNetLiquidation = value;
        }
      }

      if (line.stream === "emit") {
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

    if (failures.length > 0) {
      const maxLines = 25;
      const shown = failures.slice(0, maxLines).join("\n");
      const suffix = failures.length > maxLines ? `\n... and ${failures.length - maxLines} more` : "";
      throw new Error(`Replay found ${failures.length} issue(s):\n${shown}${suffix}`);
    }

    expect(failures).toHaveLength(0);
  });
});
