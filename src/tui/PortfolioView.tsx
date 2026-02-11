import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useStore } from "../state/store.js";
import type { Position } from "../broker/types.js";
import { resolveMarketHours, formatMarketHoursCountdown } from "../broker/ibkr/market-hours/index.js";

const STALE_THRESHOLD_MS = 180_000;

const COLUMNS = {
  ticker: 8,
  ccy: 5,
  quantity: 8,
  price: 10,
  avgCost: 10,
  unrealizedPnL: 12,
  portfolioPct: 8,
  nextTransition: 17,
  marketValue: 14,
};

const formatNumber = (value: number, decimals = 2): string => {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const formatCurrency = (value: number): string => {
  return `$${formatNumber(value)}`;
};

const PnLText: React.FC<{ value: number }> = ({ value }) => {
  const color = value > 0 ? "green" : value < 0 ? "red" : undefined;
  return <Text color={color}>{formatCurrency(value)}</Text>;
};

const padRight = (str: string, width: number): string => {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
};

const padLeft = (str: string, width: number): string => {
  return str.length >= width ? str.slice(0, width) : " ".repeat(width - str.length) + str;
};

const formatAge = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s ago`;
};

const HeaderRow: React.FC = () => (
  <Box>
    <Text color="cyan" bold>
      {padRight("Ticker", COLUMNS.ticker)}
      {padRight("CCY", COLUMNS.ccy)}
      {padLeft("Qty", COLUMNS.quantity)}
      {padLeft("Price", COLUMNS.price)}
      {padLeft("Avg Cost", COLUMNS.avgCost)}
      {padLeft("Unrealized", COLUMNS.unrealizedPnL)}
      {padLeft("% Port", COLUMNS.portfolioPct)}
      {padLeft("Mkt Hrs", COLUMNS.nextTransition)}
      {padLeft("Mkt Value", COLUMNS.marketValue)}
    </Text>
  </Box>
);

const DividerRow: React.FC = () => (
  <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
    <Text> </Text>
  </Box>
);

const CashHeaderRow: React.FC = () => (
  <Box>
    <Text color="cyan" bold>
      {padRight("Curr", COLUMNS.ticker)}
      {padRight("", COLUMNS.ccy)}
      {padLeft("", COLUMNS.quantity)}
      {padLeft("", COLUMNS.price)}
      {padLeft("", COLUMNS.avgCost)}
      {padLeft("", COLUMNS.unrealizedPnL)}
      {padLeft("", COLUMNS.portfolioPct)}
      {padLeft("FX Rate", COLUMNS.nextTransition)}
      {padLeft("Mkt Value", COLUMNS.marketValue)}
    </Text>
  </Box>
);

const PositionRow: React.FC<{ position: Position; totalValue: number; nowMs: number; baseCurrencyCode: string | null; displayFxRate: number }> = ({
  position,
  totalValue,
  nowMs,
  baseCurrencyCode,
  displayFxRate,
}) => {
  const isNonBase = baseCurrencyCode !== null && position.currency !== baseCurrencyCode;
  const isPending = position.isFxPending;
  const baseValue = isPending ? null : (position.marketValueBase ?? position.marketValue);
  const displayMarketValue = baseValue !== null ? baseValue * displayFxRate : null;
  const displayUnrealizedPnL = isPending ? position.unrealizedPnL : ((position.unrealizedPnLBase ?? position.unrealizedPnL) * displayFxRate);
  const portfolioPct = (!isPending && totalValue > 0 && displayMarketValue !== null)
    ? (displayMarketValue / totalValue) * 100
    : null;
  const mktHrs = resolveMarketHours(position.marketHours, nowMs);
  const countdownColor = mktHrs.status === "open" ? "green" : mktHrs.status === "closed" ? "yellow" : undefined;
  const nextLabel = formatMarketHoursCountdown(mktHrs);
  const ccyColor = isNonBase ? "yellow" : undefined;

  return (
    <Box>
      <Text>{padRight(position.symbol, COLUMNS.ticker)}</Text>
      <Text color={ccyColor}>{padRight(position.currency, COLUMNS.ccy)}</Text>
      <Text>{padLeft(formatNumber(position.quantity, 0), COLUMNS.quantity)}</Text>
      <Text>{padLeft(formatCurrency(position.marketPrice), COLUMNS.price)}</Text>
      <Text>{padLeft(formatCurrency(position.avgCost), COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.unrealizedPnL} justifyContent="flex-end">
        <PnLText value={displayUnrealizedPnL} />
      </Box>
      <Text>{padLeft(portfolioPct !== null ? formatNumber(portfolioPct, 1) + "%" : "", COLUMNS.portfolioPct)}</Text>
      <Text color={countdownColor}>{padLeft(nextLabel, COLUMNS.nextTransition)}</Text>
      <Text>{padLeft(isPending ? "pending" : formatCurrency(displayMarketValue ?? 0), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

type CashHolding = {
  label: string;
  value: number;
  fxRate: number | null;
  isBaseCurrency: boolean;
};

const deriveCashHoldings = (
  cashBalance: number,
  cashBalancesByCurrency: Record<string, number>,
  cashExchangeRatesByCurrency: Record<string, number>,
  baseCurrencyCode: string | null,
): CashHolding[] => {
  const perCurrency = Object.entries(cashBalancesByCurrency)
    .filter(([currency]) => currency && currency !== "BASE")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, value]) => {
      const isBaseCurrency = baseCurrencyCode !== null && currency === baseCurrencyCode;
      return {
        label: currency,
        value,
        fxRate: isBaseCurrency ? null : cashExchangeRatesByCurrency[currency] ?? null,
        isBaseCurrency,
      };
    });

  if (perCurrency.length > 0) return perCurrency;
  if (cashBalance === 0) return [];

  return [
    {
      label: baseCurrencyCode ?? "BASE",
      value: cashBalance,
      fxRate: null,
      isBaseCurrency: true,
    },
  ];
};

const CashRow: React.FC<{
  holding: CashHolding;
  displayFxRate: number;
}> = ({
  holding,
  displayFxRate,
}) => {
  const displayValue = formatCurrency(holding.value * displayFxRate);
  const fxRateLabel = holding.isBaseCurrency
    ? ""
    : holding.fxRate === null
      ? "n/a"
      : formatNumber(holding.fxRate, 4);

  return (
    <Box>
      <Text dimColor>{padRight(holding.label, COLUMNS.ticker)}</Text>
      <Text>{padRight("", COLUMNS.ccy)}</Text>
      <Text>{padLeft("", COLUMNS.quantity)}</Text>
      <Text>{padLeft("", COLUMNS.price)}</Text>
      <Text>{padLeft("", COLUMNS.avgCost)}</Text>
      <Text>{padLeft("", COLUMNS.unrealizedPnL)}</Text>
      <Text>{padLeft("", COLUMNS.portfolioPct)}</Text>
      <Text>{padLeft(fxRateLabel, COLUMNS.nextTransition)}</Text>
      <Text>{padLeft(displayValue, COLUMNS.marketValue)}</Text>
    </Box>
  );
};

const SummaryRow: React.FC<{
  label: string;
  totalValue: number;
  unrealizedPnL: number | null;
  portfolioPct: number | null;
  marginTop?: number;
}> = ({ label, totalValue, unrealizedPnL, portfolioPct, marginTop = 1 }) => {
  return (
    <Box marginTop={marginTop}>
      <Text bold>{padRight(label, COLUMNS.ticker)}</Text>
      <Text>{padRight("", COLUMNS.ccy)}</Text>
      <Text>{padLeft("", COLUMNS.quantity)}</Text>
      <Text>{padLeft("", COLUMNS.price)}</Text>
      <Text>{padLeft("", COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.unrealizedPnL} justifyContent="flex-end">
        {unrealizedPnL === null ? (
          <Text>{padLeft("", COLUMNS.unrealizedPnL)}</Text>
        ) : (
          <Text bold>
            <PnLText value={unrealizedPnL} />
          </Text>
        )}
      </Box>
      <Text>{padLeft(portfolioPct === null ? "" : `${formatNumber(portfolioPct, 1)}%`, COLUMNS.portfolioPct)}</Text>
      <Text>{padLeft("", COLUMNS.nextTransition)}</Text>
      <Text bold>{padLeft(formatCurrency(totalValue), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

const RecencyIndicator: React.FC<{ lastUpdateAt: number | null }> = ({ lastUpdateAt }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (lastUpdateAt === null) return null;

  const ageMs = Math.max(0, now - lastUpdateAt);
  const isStale = ageMs >= STALE_THRESHOLD_MS;

  return (
    <Text dimColor={!isStale} color={isStale ? "yellow" : undefined}>
      {isStale ? "Stale - " : ""}Updated {formatAge(ageMs)}
    </Text>
  );
};

const CurrencyStatusLine: React.FC<{
  baseCurrencyCode: string | null;
  displayCurrencyCode: string | null;
  pendingFxCount: number;
}> = ({ baseCurrencyCode, displayCurrencyCode, pendingFxCount }) => {
  if (!baseCurrencyCode) return null;

  return (
    <Box gap={2}>
      <Text dimColor>
        Base: <Text bold>{baseCurrencyCode}</Text>
      </Text>
      {displayCurrencyCode && displayCurrencyCode !== baseCurrencyCode && (
        <Text dimColor>
          Display: <Text bold>{displayCurrencyCode}</Text>
        </Text>
      )}
      {pendingFxCount > 0 && (
        <Text color="yellow">
          {pendingFxCount} position{pendingFxCount > 1 ? "s" : ""} pending FX
        </Text>
      )}
    </Box>
  );
};

export const PortfolioView: React.FC = () => {
  const positions = useStore((s) => s.positions);
  const totalEquity = useStore((s) => s.totalEquity);
  const cashBalance = useStore((s) => s.cashBalance);
  const cashBalancesByCurrency = useStore((s) => s.cashBalancesByCurrency);
  const cashExchangeRatesByCurrency = useStore((s) => s.cashExchangeRatesByCurrency);
  const baseCurrencyCode = useStore((s) => s.baseCurrencyCode);
  const subscribePortfolio = useStore((s) => s.subscribePortfolio);
  const initialLoadComplete = useStore((s) => s.initialLoadComplete);
  const lastPortfolioUpdateAt = useStore((s) => s.lastPortfolioUpdateAt);
  const positionsMarketValue = useStore((s) => s.positionsMarketValue);
  const positionsUnrealizedPnL = useStore((s) => s.positionsUnrealizedPnL);
  const displayCurrencyCode = useStore((s) => s.displayCurrencyCode);
  const displayCurrencyWarning = useStore((s) => s.displayCurrencyWarning);
  const positionsPendingFxCount = useStore((s) => s.positionsPendingFxCount);
  const displayFxRate = useStore((s) => s.displayFxRate);

  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePortfolio();
    return () => unsubscribe();
  }, [subscribePortfolio]);

  const cashHoldings = deriveCashHoldings(
    cashBalance,
    cashBalancesByCurrency,
    cashExchangeRatesByCurrency,
    baseCurrencyCode,
  );
  const displayPositionsMV = positionsMarketValue * displayFxRate;
  const displayPositionsPnL = positionsUnrealizedPnL * displayFxRate;
  const displayCashBalance = cashBalance * displayFxRate;
  const displayTotalEquity = totalEquity * displayFxRate;
  const positionsPortfolioPct = displayTotalEquity > 0 ? (displayPositionsMV / displayTotalEquity) * 100 : 0;

  if (!initialLoadComplete) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          Portfolio
        </Text>
        <Text dimColor>Loading full portfolio...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} gap={2}>
        <Text color="cyan" bold>
          Portfolio
        </Text>
        <RecencyIndicator lastUpdateAt={lastPortfolioUpdateAt} />
      </Box>
      <CurrencyStatusLine
        baseCurrencyCode={baseCurrencyCode}
        displayCurrencyCode={displayCurrencyCode}
        pendingFxCount={positionsPendingFxCount}
      />
      {displayCurrencyWarning && (
        <Box marginBottom={1}>
          <Text color="yellow">{displayCurrencyWarning}</Text>
        </Box>
      )}
      <HeaderRow />
      <DividerRow />
      {positions.map((position) => (
        <PositionRow
          key={position.conId}
          position={position}
          totalValue={displayTotalEquity}
          nowMs={nowMs}
          baseCurrencyCode={baseCurrencyCode}
          displayFxRate={displayFxRate}
        />
      ))}
      <DividerRow />
      <SummaryRow
        label="PORT TOT"
        totalValue={displayPositionsMV}
        unrealizedPnL={displayPositionsPnL}
        portfolioPct={positionsPortfolioPct}
        marginTop={0}
      />
      {cashHoldings.length > 0 && (
        <>
          <DividerRow />
          <Box marginBottom={1}>
            <Text color="cyan" bold>
              Cash
            </Text>
          </Box>
          <CashHeaderRow />
          <DividerRow />
          {cashHoldings.map((holding) => (
            <CashRow
              key={holding.label}
              holding={holding}
              displayFxRate={displayFxRate}
            />
          ))}
          <DividerRow />
          <SummaryRow
            label="CASH TOT"
            totalValue={displayCashBalance}
            unrealizedPnL={null}
            portfolioPct={null}
            marginTop={0}
          />
        </>
      )}
      <SummaryRow
        label="TOTAL"
        totalValue={displayTotalEquity}
        unrealizedPnL={null}
        portfolioPct={null}
        marginTop={0}
      />
    </Box>
  );
};
