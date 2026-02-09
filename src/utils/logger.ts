import fs from "node:fs";
import path from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let enabled = false;
let filePath = path.resolve(process.cwd(), "logs", "ibkr.log");
let minLevel: LogLevel = "info";

const ensureLogFile = (): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const appendLine = (line: string): void => {
  try {
    ensureLogFile();
    fs.appendFileSync(filePath, line + "\n", "utf8");
  } catch {
    // Do not fail app execution due to logging I/O issues.
  }
};

const ts = (): string => new Date().toISOString().slice(11, 23);

type LogConfig = {
  filePath: string;
  level?: LogLevel;
};

export const configureLogging = (config: LogConfig): void => {
  filePath = path.resolve(process.cwd(), config.filePath);
  minLevel = config.level ?? "info";
  enabled = true;
  appendLine("");
  appendLine(`=== log session start ${new Date().toISOString()} pid=${process.pid} level=${minLevel} ===`);
};

export const isLoggingEnabled = (): boolean => enabled;

export const log = (level: LogLevel, stream: string, detail: string): void => {
  if (!enabled) return;
  if (LEVEL_ORDER[level] > LEVEL_ORDER[minLevel]) return;
  const tag = level.toUpperCase().padEnd(5);
  appendLine(`[${ts()}] ${tag} ${stream}: ${detail}`);
};
