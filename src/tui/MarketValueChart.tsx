import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useStdout } from "ink";
import asciichart from "asciichart";
import { useStore } from "../state/store.js";

type Props = { height?: number };

const LABEL_WIDTH = 15; // Width of Y-axis labels (e.g., "+$138,914.12")
const AXIS_WIDTH = 2;   // Width of axis characters (┼ and space)

const formatCurrency = (value: number): string =>
  "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDelta = (value: number): string => {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(value))}`;
};

export const MarketValueChart: React.FC<Props> = ({ height = 7 }) => {
  const marketValueHistory = useStore((s) => s.marketValueHistory);
  const chartStartTime = useStore((s) => s.chartStartTime);
  const chartStartValue = useStore((s) => s.chartStartValue);
  const [elapsed, setElapsed] = useState(0);
  const { stdout } = useStdout();
  const scaleMinRef = useRef<number | null>(null);
  const scaleMaxRef = useRef<number | null>(null);

  // Get terminal width, default to 80 if not available
  const terminalWidth = stdout?.columns ?? 80;
  // Data points width = terminal - labels - axis - safety margin
  const maxDataPoints = Math.max(20, terminalWidth - LABEL_WIDTH - AXIS_WIDTH - 5);

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

  // Reset scale when a new session starts
  useEffect(() => {
    scaleMinRef.current = null;
    scaleMaxRef.current = null;
  }, [chartStartTime]);

  if (marketValueHistory.length < 2) {
    return <Text dimColor>Collecting data for chart...</Text>;
  }

  // Take only the last N points to fit the chart width
  // This ensures old points don't change position as new data arrives
  const dataPoints = marketValueHistory.slice(-maxDataPoints);

  // Convert to deltas from session start for intuitive "am I up or down?"
  const baseline = chartStartValue ?? dataPoints[0];
  const deltaPoints = dataPoints.map((v) => v - baseline);

  const rawMin = Math.min(...deltaPoints);
  const rawMax = Math.max(...deltaPoints);

  // Hysteresis: only expand scale when new highs/lows happen; never shrink
  if (scaleMinRef.current === null || rawMin < scaleMinRef.current) {
    scaleMinRef.current = rawMin;
  }
  if (scaleMaxRef.current === null || rawMax > scaleMaxRef.current) {
    scaleMaxRef.current = rawMax;
  }

  const observedRange = scaleMaxRef.current - scaleMinRef.current;
  const padding = Math.max(observedRange * 0.05, 1); // 5% of range or $1
  const min = scaleMinRef.current - padding;
  const max = scaleMaxRef.current + padding;
  const safeMax = Math.max(max, min + 1); // ensure non-zero range

  const chart = asciichart.plot(deltaPoints, {
    height,
    min,
    max: safeMax,
    format: (x: number) => formatDelta(x).padStart(LABEL_WIDTH),
  });
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">Portfolio Δ since connect ({minutes}m {seconds}s)</Text>
      <Text wrap="truncate">{chart}</Text>
    </Box>
  );
};
