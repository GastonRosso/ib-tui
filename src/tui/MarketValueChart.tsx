import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import asciichart from "asciichart";
import { useStore } from "../state/store.js";

type Props = { height?: number; width?: number };

export const MarketValueChart: React.FC<Props> = ({ height = 8, width = 60 }) => {
  const marketValueHistory = useStore((s) => s.marketValueHistory);
  const chartStartTime = useStore((s) => s.chartStartTime);
  const [elapsed, setElapsed] = useState(0);

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

  // Sample data to fit width (take every Nth point)
  const step = Math.max(1, Math.floor(marketValueHistory.length / width));
  const sampled = marketValueHistory.filter((_, i) => i % step === 0);

  const chart = asciichart.plot(sampled, { height });
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">Portfolio Value ({minutes}m {seconds}s)</Text>
      <Text>{chart}</Text>
    </Box>
  );
};
