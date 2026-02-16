import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useStore } from "../state/store.js";
import type { StatusEvent } from "../state/store.js";
import type { ConnectionHealth, ConnectionStatus } from "../state/types.js";
import { PortfolioView, STALE_THRESHOLD_MS } from "./PortfolioView.js";

type FocusPanel = "status" | "portfolio" | "cash";

const formatAge = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, "0")}s`;
};

const getTransportColor = (status: ConnectionStatus): string => {
  if (status === "connected") return "green";
  if (status === "connecting") return "yellow";
  return "red";
};

const getHealthColor = (health: ConnectionHealth): string => {
  if (health === "healthy") return "green";
  if (health === "degraded") return "yellow";
  return "red";
};

const getStatusEventColor = (event: StatusEvent | null): string | undefined => {
  if (!event) return "gray";
  if (event.level === "error") return "red";
  if (event.level === "warn") return "yellow";
  return "gray";
};

const formatStatusEvent = (
  event: StatusEvent | null,
  nowMs: number,
  index: number,
  total: number,
): string => {
  if (!event) return "No status events yet";

  const codePrefix = event.code !== undefined ? `[${event.code}] ` : "";
  const age = formatAge(Math.max(0, nowMs - event.at));
  const repeats = event.repeatCount > 1 ? ` | x${event.repeatCount}` : "";
  const position = `${Math.max(1, index + 1)}/${total}`;

  return `${codePrefix}${event.message} | ${age} ago${repeats} | ${position}`;
};

const formatDataAge = (
  lastPortfolioUpdateAt: number | null,
  nowMs: number,
): { label: string; color: string | undefined } => {
  if (lastPortfolioUpdateAt === null) {
    return { label: "n/a", color: "gray" };
  }

  const ageMs = Math.max(0, nowMs - lastPortfolioUpdateAt);
  const isStale = ageMs >= STALE_THRESHOLD_MS;
  return {
    label: `${isStale ? "stale" : "fresh"} ${formatAge(ageMs)}`,
    color: isStale ? "yellow" : "green",
  };
};

const formatRetry = (nextRetryAt: number | null, retryAttempt: number, nowMs: number): string => {
  if (nextRetryAt === null || retryAttempt <= 0) return "-";
  const seconds = Math.max(0, Math.ceil((nextRetryAt - nowMs) / 1000));
  return `#${retryAttempt} in ${seconds}s`;
};

const FocusChip: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <Text color={active ? "cyan" : "gray"} bold={active}>
    {active ? `>${label}<` : label}
  </Text>
);

export const App: React.FC = () => {
  const { exit } = useApp();

  const connectionStatus = useStore((s) => s.connectionStatus);
  const connectionHealth = useStore((s) => s.connectionHealth);
  const disconnect = useStore((s) => s.disconnect);
  const startAutoConnect = useStore((s) => s.startAutoConnect);
  const stopAutoConnect = useStore((s) => s.stopAutoConnect);
  const cycleDisplayCurrency = useStore((s) => s.cycleDisplayCurrency);
  const statusHistory = useStore((s) => s.statusHistory);
  const statusHistoryIndex = useStore((s) => s.statusHistoryIndex);
  const selectOlderStatus = useStore((s) => s.selectOlderStatus);
  const selectNewerStatus = useStore((s) => s.selectNewerStatus);
  const retryAttempt = useStore((s) => s.retryAttempt);
  const nextRetryAt = useStore((s) => s.nextRetryAt);
  const lastPortfolioUpdateAt = useStore((s) => s.lastPortfolioUpdateAt);

  const [focusedPanel, setFocusedPanel] = useState<FocusPanel>("status");
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    startAutoConnect();
    return () => {
      stopAutoConnect();
    };
  }, [startAutoConnect, stopAutoConnect]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      stopAutoConnect();
      void disconnect().finally(() => exit());
      return;
    }

    if (input === "]") {
      cycleDisplayCurrency("next");
      return;
    }

    if (input === "[") {
      cycleDisplayCurrency("prev");
      return;
    }

    if (input === "1") {
      setFocusedPanel("status");
      return;
    }

    if (input === "2") {
      setFocusedPanel("portfolio");
      return;
    }

    if (input === "3") {
      setFocusedPanel("cash");
      return;
    }

    if (focusedPanel === "status") {
      if (key.upArrow) {
        selectOlderStatus();
        return;
      }
      if (key.downArrow) {
        selectNewerStatus();
      }
    }
  });

  const selectedStatus =
    statusHistory.length > 0
      ? statusHistory[Math.min(statusHistoryIndex, statusHistory.length - 1)]
      : null;

  const dataAge = useMemo(
    () => formatDataAge(lastPortfolioUpdateAt, nowMs),
    [lastPortfolioUpdateAt, nowMs],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          IBKR TUI
        </Text>
      </Box>

      <Box marginBottom={1}>
        <FocusChip label="[1] Status" active={focusedPanel === "status"} />
        <Text dimColor> | </Text>
        <Text>
          transport: <Text color={getTransportColor(connectionStatus)}>{connectionStatus}</Text>
        </Text>
        <Text dimColor> | </Text>
        <Text>
          health: <Text color={getHealthColor(connectionHealth)}>{connectionHealth}</Text>
        </Text>
        <Text dimColor> | </Text>
        <Text>
          data: <Text color={dataAge.color}>{dataAge.label}</Text>
        </Text>
        <Text dimColor> | </Text>
        <Text>retry: {formatRetry(nextRetryAt, retryAttempt, nowMs)}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={getStatusEventColor(selectedStatus)}>
          {formatStatusEvent(selectedStatus, nowMs, statusHistoryIndex, statusHistory.length)}
        </Text>
      </Box>

      <MainView focusedPanel={focusedPanel} />
    </Box>
  );
};

const MainView: React.FC<{ focusedPanel: FocusPanel }> = ({ focusedPanel }) => {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const error = useStore((s) => s.error);
  const initialLoadComplete = useStore((s) => s.initialLoadComplete);
  const lastPortfolioUpdateAt = useStore((s) => s.lastPortfolioUpdateAt);
  const positionsCount = useStore((s) => s.positions.length);

  const hasSnapshot =
    initialLoadComplete || lastPortfolioUpdateAt !== null || positionsCount > 0;

  if (connectionStatus !== "connected" && !hasSnapshot) {
    return (
      <Box flexDirection="column">
        <Text>Waiting for connection...</Text>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  return (
    <PortfolioView
      isPortfolioFocused={focusedPanel === "portfolio"}
      isCashFocused={focusedPanel === "cash"}
    />
  );
};
