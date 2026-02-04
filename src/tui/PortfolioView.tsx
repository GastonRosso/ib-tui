import React, { useEffect } from "react";
import { Box, Text } from "ink";
import { useStore } from "../state/store.js";
import type { Position } from "../broker/types.js";
import { MarketValueChart } from "./MarketValueChart.js";

const COLUMNS = {
  ticker: 8,
  quantity: 10,
  price: 12,
  avgCost: 12,
  dayPnL: 12,
  dayPnLPct: 10,
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

const formatPercent = (value: number): string => {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatNumber(value)}%`;
};

const PnLText: React.FC<{ value: number; format?: "currency" | "percent" }> = ({
  value,
  format = "currency",
}) => {
  const color = value > 0 ? "green" : value < 0 ? "red" : undefined;
  const formattedValue = format === "percent" ? formatPercent(value) : formatCurrency(value);
  return <Text color={color}>{formattedValue}</Text>;
};

const padRight = (str: string, width: number): string => {
  return str.length >= width ? str.slice(0, width) : str + " ".repeat(width - str.length);
};

const padLeft = (str: string, width: number): string => {
  return str.length >= width ? str.slice(0, width) : " ".repeat(width - str.length) + str;
};

const HeaderRow: React.FC = () => (
  <Box>
    <Text color="cyan" bold>
      {padRight("Ticker", COLUMNS.ticker)}
      {padLeft("Qty", COLUMNS.quantity)}
      {padLeft("Price", COLUMNS.price)}
      {padLeft("Avg Cost", COLUMNS.avgCost)}
      {padLeft("Day P&L", COLUMNS.dayPnL)}
      {padLeft("Day %", COLUMNS.dayPnLPct)}
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
  const previousValue = position.marketValue - position.dailyPnL;
  const dayPnLPct = previousValue !== 0 ? (position.dailyPnL / previousValue) * 100 : 0;

  return (
    <Box>
      <Text>{padRight(position.symbol, COLUMNS.ticker)}</Text>
      <Text>{padLeft(formatNumber(position.quantity, 0), COLUMNS.quantity)}</Text>
      <Text>{padLeft(formatCurrency(position.marketPrice), COLUMNS.price)}</Text>
      <Text>{padLeft(formatCurrency(position.avgCost), COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.dayPnL} justifyContent="flex-end">
        <PnLText value={position.dailyPnL} />
      </Box>
      <Box width={COLUMNS.dayPnLPct} justifyContent="flex-end">
        <PnLText value={dayPnLPct} format="percent" />
      </Box>
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
      <Text>{padLeft("", COLUMNS.dayPnL)}</Text>
      <Text>{padLeft("", COLUMNS.dayPnLPct)}</Text>
      <Text>{padLeft("", COLUMNS.unrealizedPnL)}</Text>
      <Text>{padLeft(formatNumber(portfolioPct, 1) + "%", COLUMNS.portfolioPct)}</Text>
      <Text>{padLeft(formatCurrency(cashBalance), COLUMNS.marketValue)}</Text>
    </Box>
  );
};

const SummaryRow: React.FC<{
  positions: Position[];
  totalValue: number;
  accountDailyPnL: number;
}> = ({ positions, totalValue, accountDailyPnL }) => {
  const totalUnrealizedPnL = positions.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  const previousTotalValue = totalValue - accountDailyPnL;
  const dayPnLPct = previousTotalValue !== 0 ? (accountDailyPnL / previousTotalValue) * 100 : 0;

  return (
    <Box marginTop={1}>
      <Text bold>{padRight("TOTAL", COLUMNS.ticker)}</Text>
      <Text>{padLeft("", COLUMNS.quantity)}</Text>
      <Text>{padLeft("", COLUMNS.price)}</Text>
      <Text>{padLeft("", COLUMNS.avgCost)}</Text>
      <Box width={COLUMNS.dayPnL} justifyContent="flex-end">
        <Text bold>
          <PnLText value={accountDailyPnL} />
        </Text>
      </Box>
      <Box width={COLUMNS.dayPnLPct} justifyContent="flex-end">
        <Text bold>
          <PnLText value={dayPnLPct} format="percent" />
        </Text>
      </Box>
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

export const PortfolioView: React.FC = () => {
  const { positions, totalPortfolioValue, accountDailyPnL, cashBalance, subscribePortfolio } = useStore();

  useEffect(() => {
    const unsubscribe = subscribePortfolio();
    return () => unsubscribe();
  }, [subscribePortfolio]);

  if (positions.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          Portfolio
        </Text>
        <Text dimColor>Loading positions...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <MarketValueChart />
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Portfolio
        </Text>
      </Box>
      <HeaderRow />
      <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text> </Text>
      </Box>
      {positions.map((position) => (
        <PositionRow
          key={position.conId}
          position={position}
          totalValue={totalPortfolioValue + cashBalance}
        />
      ))}
      <CashRow cashBalance={cashBalance} totalValue={totalPortfolioValue + cashBalance} />
      <SummaryRow
        positions={positions}
        totalValue={totalPortfolioValue + cashBalance}
        accountDailyPnL={accountDailyPnL}
      />
    </Box>
  );
};
