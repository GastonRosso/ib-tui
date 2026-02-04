#!/usr/bin/env node
import { render } from "ink";
import React from "react";
import { App } from "./tui/App.js";

const { waitUntilExit } = render(React.createElement(App));

waitUntilExit().then(() => {
  process.exit(0);
});
