import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { useStore } from "../state/store.js";
import type { Position } from "../broker/types.js";

const STALE_THRESHOLD_MS = 180_000;

const COLUMNS = {
  ticker: 8,
  quantity: 10,
  price: 12,
  avgCost: 12,
  unrealizedPnL: 14,
  portfolioPct: 10,
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
      {padLeft("Qty", COLUMNS.quantity)}
      {padLeft("Price", COLUMNS.price)}
      {padLeft("Avg Cost", COLUMNS.avgCost)}
      {padLeft("Unrealized", COLUMNS.unrealizedPnL)}
      {padLeft("% Port", COLUMNS.portfolioPct)}
      {padLeft("Mkt Value", COLUMNS.marketValue)}
    </Text>
  </Box>
);

const PositionRow: React.FC<{ position: Position; totalValue: number }> = ({
  position,
  totalValue,
}) => {
  const portfolioPct = totalValue > 0 ? (position.marketValue / totalValue) * 100 : 0;

  return (
    <Box>
      <Text>{padRight(position.symbol, COLUMNS.ticker)}</Text>
      <Text>{padLeft(formatNumber(position.quantity, 0), COLUMNS.quantity)}</Text>
      <Text>{padLeft(formatCurrency(position.marketPrice), COLUMNS.price)}</Text>
      <Text>{padLeft(formatCurrency(position.avgCost), COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.unrealizedPnL} justifyContent="flex-end">
        <PnLText value={position.unrealizedPnL} />
      </Box>
      <Text>{padLeft(formatNumber(portfolioPct, 1) + "%", COLUMNS.portfolioPct)}</Text>
      <Text>{padLeft(formatCurrency(position.marketValue), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

const CashRow: React.FC<{ cashBalance: number; totalValue: number }> = ({
  cashBalance,
  totalValue,
}) => {
  const portfolioPct = totalValue > 0 ? (cashBalance / totalValue) * 100 : 0;

  return (
    <Box>
      <Text dimColor>{padRight("Cash", COLUMNS.ticker)}</Text>
      <Text>{padLeft("", COLUMNS.quantity)}</Text>
      <Text>{padLeft("", COLUMNS.price)}</Text>
      <Text>{padLeft("", COLUMNS.avgCost)}</Text>
      <Text>{padLeft("", COLUMNS.unrealizedPnL)}</Text>
      <Text>{padLeft(formatNumber(portfolioPct, 1) + "%", COLUMNS.portfolioPct)}</Text>
      <Text>{padLeft(formatCurrency(cashBalance), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

const SummaryRow: React.FC<{
  positions: Position[];
  totalValue: number;
}> = ({ positions, totalValue }) => {
  const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);

  return (
    <Box marginTop={1}>
      <Text bold>{padRight("TOTAL", COLUMNS.ticker)}</Text>
      <Text>{padLeft("", COLUMNS.quantity)}</Text>
      <Text>{padLeft("", COLUMNS.price)}</Text>
      <Text>{padLeft("", COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.unrealizedPnL} justifyContent="flex-end">
        <Text bold>
          <PnLText value={totalUnrealizedPnL} />
        </Text>
      </Box>
      <Text>{padLeft("100.0%", COLUMNS.portfolioPct)}</Text>
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

export const PortfolioView: React.FC = () => {
  const {
    positions,
    totalEquity,
    cashBalance,
    subscribePortfolio,
    initialLoadComplete,
    lastPortfolioUpdateAt,
  } = useStore();

  useEffect(() => {
    const unsubscribe = subscribePortfolio();
    return () => unsubscribe();
  }, [subscribePortfolio]);

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
      <HeaderRow />
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text> </Text>
      </Box>
      {positions.map((position) => (
        <PositionRow
          key={position.conId}
          position={position}
          totalValue={totalEquity}
        />
      ))}
      <CashRow cashBalance={cashBalance} totalValue={totalEquity} />
      <SummaryRow
        positions={positions}
        totalValue={totalEquity}
      />
    </Box>
  );
};
