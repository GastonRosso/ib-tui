#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./tui/App.js";
import { configureLogging } from "./utils/logger.js";
import type { LogLevel } from "./utils/logger.js";

const VALID_LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];
const args = process.argv.slice(2);
const isLogLevel = (value: string): value is LogLevel =>
  value === "error" || value === "warn" || value === "info" || value === "debug";

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

const { waitUntilExit } = render(React.createElement(App));

waitUntilExit().then(() => {
  process.exit(0);
});
