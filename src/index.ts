#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./tui/App.js";
import { configureLogging, LOG_LEVELS } from "./utils/logger.js";
import type { LogLevel } from "./utils/logger.js";
import { parseCliArgs } from "./config/cliArgs.js";
import { useStore } from "./state/store.js";

const VALID_LEVELS = [...LOG_LEVELS];
const VALID_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS);
const args = process.argv.slice(2);
const isLogLevel = (value: string): value is LogLevel =>
  VALID_LEVEL_SET.has(value);

const hasLegacyFlags = args.some(
  (arg) => arg === "--debug-streams" || arg.startsWith("--debug-streams-file")
);

if (hasLegacyFlags) {
  process.stderr.write(
    'Legacy logging flags are not supported. Use "--log-file[=<path>]" and "--log-level=<error|warn|info|debug>".\n'
  );
  process.exit(1);
}

const logFileArg = args.find((arg) => arg === "--log-file" || arg.startsWith("--log-file="));
const logLevelArg = args.find((arg) => arg.startsWith("--log-level="));
const hasBareLogLevelArg = args.includes("--log-level");

if (hasBareLogLevelArg) {
  process.stderr.write(
    'Invalid "--log-level" usage. Use "--log-level=<error|warn|info|debug>".\n'
  );
  process.exit(1);
}

if (logLevelArg && !logFileArg) {
  process.stderr.write('The "--log-level" flag requires "--log-file".\n');
  process.exit(1);
}

if (logFileArg) {
  const logFile = logFileArg.includes("=")
    ? logFileArg.slice("--log-file=".length)
    : "logs/ibkr.log";
  if (!logFile.trim()) {
    process.stderr.write('Invalid "--log-file" value. Provide a non-empty path.\n');
    process.exit(1);
  }

  let level: LogLevel = "info";
  if (logLevelArg) {
    const raw = logLevelArg.slice("--log-level=".length).toLowerCase();
    if (!isLogLevel(raw)) {
      process.stderr.write(`Invalid --log-level="${raw}". Valid values: ${VALID_LEVELS.join(", ")}\n`);
      process.exit(1);
    }
    level = raw;
  }

  configureLogging({ filePath: logFile, level });
}

try {
  const cliArgs = parseCliArgs(args);
  if (cliArgs.portfolioCurrency) {
    useStore.getState().setDisplayCurrencyPreference(cliArgs.portfolioCurrency);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const { waitUntilExit } = render(React.createElement(App));

void waitUntilExit().then(() => {
  process.exit(0);
});
