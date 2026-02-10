import React, { useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useStore } from "../state/store.js";
import type { ConnectionStatus } from "../state/types.js";
import { PortfolioView } from "./PortfolioView.js";

export const App: React.FC = () => {
  const { exit } = useApp();
  const connectionStatus = useStore((s) => s.connectionStatus);
  const connect = useStore((s) => s.connect);
  const disconnect = useStore((s) => s.disconnect);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      void disconnect().finally(() => exit());
    }
    if (input === "c" && (connectionStatus === "disconnected" || connectionStatus === "error")) {
      void connect();
    }
  });

  useEffect(() => {
    // Auto-connect on startup can be enabled here
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          IBKR TUI
        </Text>
        <Text dimColor> | </Text>
        <StatusIndicator status={connectionStatus} />
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>Press 'c' to connect, 'q' to quit</Text>
      </Box>

      <MainView />
    </Box>
  );
};

const StatusIndicator: React.FC<{ status: ConnectionStatus }> = ({ status }) => {
  const color = status === "connected" ? "green" : status === "connecting" ? "yellow" : "red";
  return <Text color={color}>● {status}</Text>;
};

const MainView: React.FC = () => {
  const connectionStatus = useStore((s) => s.connectionStatus);
  const error = useStore((s) => s.error);

  if (connectionStatus !== "connected") {
    return (
      <Box flexDirection="column">
        <Text>Waiting for connection...</Text>
        {error && <Text color="red">{error}</Text>}
      </Box>
    );
  }

  return <PortfolioView />;
};
