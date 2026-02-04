import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import asciichart from "asciichart";
import { useStore } from "../state/store.js";

type Props = { height?: number };

const LABEL_WIDTH = 13; // Width of Y-axis labels (e.g., "    $138,914 ")

const formatCurrency = (value: number): string => {
  // Round to nearest dollar and format with commas
  const rounded = Math.round(value);
  return "$" + rounded.toLocaleString("en-US");
};

export const MarketValueChart: React.FC<Props> = ({ height = 5 }) => {
  const marketValueHistory = useStore((s) => s.marketValueHistory);
  const chartStartTime = useStore((s) => s.chartStartTime);
  const [elapsed, setElapsed] = useState(0);
  const { stdout } = useStdout();

  // Get terminal width, default to 80 if not available
  const terminalWidth = stdout?.columns ?? 80;
  // Chart width = terminal width - label width - small margin
  const chartWidth = Math.max(20, terminalWidth - LABEL_WIDTH - 2);

  useEffect(() => {
    if (chartStartTime === null) {
      setElapsed(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - chartStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [chartStartTime]);

  if (marketValueHistory.length < 2) {
    return <Text dimColor>Collecting data for chart...</Text>;
  }

  // Take only the last N points to fit the chart width
  // This ensures old points don't change position as new data arrives
  const dataPoints = marketValueHistory.slice(-chartWidth);

  const chart = asciichart.plot(dataPoints, {
    height,
    format: (x: number) => formatCurrency(x).padStart(LABEL_WIDTH),
  });
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">Portfolio Value ({minutes}m {seconds}s)</Text>
      <Text>{chart}</Text>
    </Box>
  );
};
