import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { configureLogging, log, isLoggingEnabled } from "./logger.js";

const testDir = path.resolve(process.cwd(), "test-logs");

const readLog = (filePath: string): string[] =>
  fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);

describe("logger", () => {
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("writes log entries that match configured level or higher severity", () => {
    const logFile = path.join(testDir, "level-filter.log");
    configureLogging({ filePath: logFile, level: "info" });

    log("error", "test", "error msg");
    log("warn", "test", "warn msg");
    log("info", "test", "info msg");
    log("debug", "test", "debug msg");

    const lines = readLog(logFile);
    const dataLines = lines.filter((l) => l.startsWith("["));

    expect(dataLines).toHaveLength(3);
    expect(dataLines[0]).toContain("ERROR");
    expect(dataLines[1]).toContain("WARN");
    expect(dataLines[2]).toContain("INFO");
    expect(dataLines.some((l) => l.includes("DEBUG"))).toBe(false);
  });

  it("writes all levels when configured at debug", () => {
    const logFile = path.join(testDir, "debug-all.log");
    configureLogging({ filePath: logFile, level: "debug" });

    log("error", "test", "e");
    log("warn", "test", "w");
    log("info", "test", "i");
    log("debug", "test", "d");

    const lines = readLog(logFile);
    const dataLines = lines.filter((l) => l.startsWith("["));

    expect(dataLines).toHaveLength(4);
  });

  it("only writes error when configured at error level", () => {
    const logFile = path.join(testDir, "error-only.log");
    configureLogging({ filePath: logFile, level: "error" });

    log("error", "test", "e");
    log("warn", "test", "w");
    log("info", "test", "i");
    log("debug", "test", "d");

    const lines = readLog(logFile);
    const dataLines = lines.filter((l) => l.startsWith("["));

    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("ERROR");
  });

  it("defaults to info level when level is not specified", () => {
    const logFile = path.join(testDir, "default-level.log");
    configureLogging({ filePath: logFile });

    log("info", "test", "visible");
    log("debug", "test", "hidden");

    const lines = readLog(logFile);
    const dataLines = lines.filter((l) => l.startsWith("["));

    expect(dataLines).toHaveLength(1);
    expect(dataLines[0]).toContain("INFO");
  });

  it("formats log lines as [HH:MM:SS.mmm] LEVEL stream: detail", () => {
    const logFile = path.join(testDir, "format.log");
    configureLogging({ filePath: logFile, level: "debug" });

    log("info", "event.test", "hello world");

    const lines = readLog(logFile);
    const dataLine = lines.find((l) => l.startsWith("[") && l.includes("event.test"));
    expect(dataLine).toBeDefined();
    expect(dataLine).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\s+INFO\s+event\.test:\s+hello world$/);
  });

  it("reports logging as enabled after configuration", () => {
    const logFile = path.join(testDir, "enabled.log");
    configureLogging({ filePath: logFile });
    expect(isLoggingEnabled()).toBe(true);
  });
});
