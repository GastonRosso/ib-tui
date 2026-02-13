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
  currency: string;
};

type ReplayState = {
  selectedAccount: string;
  positions: Map<number, PositionState>;
  brokerCashBalance: number;
  baseCurrencyCode: string | null;
  localCashBalancesByCurrency: Map<string, number>;
  exchangeRatesByCurrency: Map<string, number>;
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

const sumPositionsInBase = (
  positions: Map<number, PositionState>,
  baseCurrencyCode: string | null,
  exchangeRates: Map<string, number>,
): number => {
  let sum = 0;
  for (const position of positions.values()) {
    if (!baseCurrencyCode || position.currency === baseCurrencyCode) {
      sum += position.marketValue;
    } else {
      const rate = exchangeRates.get(position.currency);
      if (rate !== undefined) {
        sum += position.marketValue * rate;
      }
      // Pending FX positions excluded from total (matches projection behavior)
    }
  }
  return sum;
};

const computeConvertedCashBreakdown = (state: ReplayState): {
  rows: Array<[string, number]>;
  allConvertible: boolean;
} => {
  const baseCurrencyCode = state.baseCurrencyCode;
  const rawByCurrency = new Map<string, number>();
  let allConvertible = true;

  for (const [currency, localAmount] of state.localCashBalancesByCurrency.entries()) {
    if (baseCurrencyCode && currency === baseCurrencyCode) {
      rawByCurrency.set(currency, localAmount);
      continue;
    }

    const exchangeRate = state.exchangeRatesByCurrency.get(currency);
    if (exchangeRate === undefined) {
      allConvertible = false;
      continue;
    }

    const rawValueInBase = localAmount * exchangeRate;
    rawByCurrency.set(currency, rawValueInBase);
  }

  const rows: Array<[string, number]> = [];
  for (const [currency, rawValueInBase] of rawByCurrency.entries()) {
    rows.push([currency, rawValueInBase]);
  }
  rows.sort(([a], [b]) => a.localeCompare(b));
  return { rows, allConvertible };
};

const sumConvertedCashInBase = (state: ReplayState): number =>
  computeConvertedCashBreakdown(state).rows.reduce((sum, [, value]) => sum + value, 0);

const formatConvertedCashRows = (state: ReplayState): string => {
  const rows = computeConvertedCashBreakdown(state).rows;
  if (rows.length === 0) return "none";
  return rows.map(([currency, value]) => `${currency}:${value.toFixed(2)}`).join(",");
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
      brokerCashBalance: 0,
      baseCurrencyCode: null,
      localCashBalancesByCurrency: new Map(),
      exchangeRatesByCurrency: new Map(),
    });

    let state: ReplayState = createInitialState();
    let session = 0;

    const failures: string[] = [];
    const absTol = 0.05;

    let sawPnlSubscription = false;
    let sawPnlSingleSubscription = false;
    let sawNonBaseCashBalance = false;
    let sawExchangeRate = false;
    let sawContractDetailsRequest = false;
    let sawContractDetails = false;
    const pendingFxReqIds = new Set<number>();

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

        // Infer currency from contract details in the log line if available,
        // otherwise default to base currency (most common case for single-currency accounts)
        const currency = line.fields.ccy ?? state.baseCurrencyCode ?? "USD";

        state.positions.set(conId, {
          quantity: qty,
          marketValue,
          marketPrice,
          currency,
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

        if (key === "TotalCashBalance") {
          if (currency === "BASE") {
            state.brokerCashBalance = value;
          } else if (currency) {
            state.localCashBalancesByCurrency.set(currency, value);
            sawNonBaseCashBalance = true;
          }
        }

        if ((key === "TotalCashValue" || key === "NetLiquidation") && currency && currency !== "BASE") {
          state.baseCurrencyCode = currency;
        }

        if (key === "ExchangeRate" && currency) {
          state.exchangeRatesByCurrency.set(currency, value);
          sawExchangeRate = true;
        }
      }

      if (line.stream === "event.reqContractDetails") {
        sawContractDetailsRequest = true;
      }

      if (line.stream === "event.contractDetails") {
        sawContractDetails = true;
      }

      if (line.stream === "subscription.fx" && line.detail.includes("reqMktData start")) {
        const reqId = toFiniteNumber(line.fields.reqId);
        if (reqId !== null) pendingFxReqIds.add(reqId);
      }

      if (line.stream === "event.fxRate") {
        const reqId = toFiniteNumber(line.fields.reqId);
        const currency = line.fields.currency;
        const rate = toFiniteNumber(line.fields.rate);
        if (reqId !== null) pendingFxReqIds.delete(reqId);
        if (currency && rate !== null) {
          state.exchangeRatesByCurrency.set(currency, rate);
          sawExchangeRate = true;
        }
      }

      if (line.stream === "error") {
        const reqId = toFiniteNumber(line.fields.reqId);
        if (reqId !== null) pendingFxReqIds.delete(reqId);
      }

      if (line.stream === "state.snapshot") {
        const emittedPositions = toFiniteNumber(line.fields.positionsMV);
        const emittedCash = toFiniteNumber(line.fields.cash);
        const emittedCashFx = toFiniteNumber(line.fields.cashFx);
        const emittedCashFxRows = line.fields.cashFxRows;
        const emittedTotal = toFiniteNumber(line.fields.totalEquity);
        if (emittedPositions === null || emittedCash === null || emittedTotal === null) {
          continue;
        }

        const expectedPositions = sumPositionsInBase(state.positions, state.baseCurrencyCode, state.exchangeRatesByCurrency);
        const expectedCashFx = sumConvertedCashInBase(state);
        const expectedCash = state.localCashBalancesByCurrency.size > 0
          ? expectedCashFx
          : state.brokerCashBalance;
        const expectedTotal = expectedPositions + expectedCash;

        if (Math.abs(expectedPositions - emittedPositions) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] positionsMV expected=${expectedPositions.toFixed(2)} emitted=${emittedPositions.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (Math.abs(expectedCash - emittedCash) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] cash expected=${expectedCash.toFixed(2)} emitted=${emittedCash.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (Math.abs(expectedTotal - emittedTotal) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] total expected=${expectedTotal.toFixed(2)} emitted=${emittedTotal.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (emittedCashFx !== null && Math.abs(expectedCashFx - emittedCashFx) > absTol) {
          failures.push(
            `[session=${session} line=${line.lineNo}] [emit mismatch] cashFx expected=${expectedCashFx.toFixed(2)} emitted=${emittedCashFx.toFixed(2)} t=${line.timeMs}`
          );
        }

        if (emittedCashFxRows) {
          const expectedRows = formatConvertedCashRows(state);
          if (expectedRows !== emittedCashFxRows) {
            failures.push(
              `[session=${session} line=${line.lineNo}] [emit mismatch] cashFxRows expected=${expectedRows} emitted=${emittedCashFxRows} t=${line.timeMs}`
            );
          }
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
    if (sawNonBaseCashBalance && !sawExchangeRate) {
      failures.push("[regression] Found non-BASE cash balances but no ExchangeRate events in log");
    }
    if (sawContractDetailsRequest && !sawContractDetails) {
      failures.push("[regression] Contract details were requested but never returned; market-hours will remain n/a");
    }
    if (pendingFxReqIds.size > 0) {
      failures.push(`[regression] FX reqMktData started but no fxRate/error observed for reqIds=${Array.from(pendingFxReqIds).join(",")}`);
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
