import fs from "node:fs";
import path from "node:path";

let enabled = false;
let filePath = path.resolve(process.cwd(), "logs", "ibkr-streams.log");

const ensureLogFile = (): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const appendLine = (line: string): void => {
  try {
    ensureLogFile();
    fs.appendFileSync(filePath, line + "\n", "utf8");
  } catch {
    // Do not fail app execution due to debug logging I/O issues.
  }
};

export const setDebugStreamsFilePath = (nextPath: string): void => {
  if (!nextPath) return;
  filePath = path.resolve(process.cwd(), nextPath);
};

export const setDebugStreams = (value: boolean): void => {
  enabled = value;
};

export const isDebugStreams = (): boolean => enabled;

export const getDebugStreamsFilePath = (): string => filePath;

type DebugConfig = {
  enabled: boolean;
  filePath?: string;
};

export const configureDebugStreams = (config: DebugConfig): void => {
  if (config.filePath) {
    setDebugStreamsFilePath(config.filePath);
  }
  setDebugStreams(config.enabled);
  if (config.enabled) {
    appendLine("");
    appendLine(`=== debug session start ${new Date().toISOString()} pid=${process.pid} ===`);
  }
};

const ts = (): string => new Date().toISOString().slice(11, 23);

export const debugLog = (stream: string, detail: string): void => {
  if (!enabled) return;
  appendLine(`[${ts()}] ${stream}: ${detail}`);
};
