#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./tui/App.js";
import { configureDebugStreams, getDebugStreamsFilePath } from "./broker/ibkr/debug.js";

const debugStreamsFileArg = process.argv.find((arg) =>
  arg.startsWith("--debug-streams-file=")
);
const debugStreamsFile = debugStreamsFileArg?.slice("--debug-streams-file=".length);
const debugStreamsEnabled = process.argv.includes("--debug-streams") || Boolean(debugStreamsFile);

configureDebugStreams({
  enabled: debugStreamsEnabled,
  filePath: debugStreamsFile,
});

const { waitUntilExit } = render(React.createElement(App));

waitUntilExit().then(() => {
  if (debugStreamsEnabled) {
    // Final note in stdout so users know where logs were written after app exits.
    process.stdout.write(`Debug streams log saved at ${getDebugStreamsFilePath()}\n`);
  }
  process.exit(0);
});
