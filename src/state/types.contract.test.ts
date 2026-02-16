import { describe, it, expectTypeOf } from "vitest";
import type { ConnectionHealth, ConnectionStatus } from "./types.js";
import type { LogLevel } from "../utils/logger.js";

describe("shared primitive contracts", () => {
  it("exports strict connection statuses", () => {
    expectTypeOf<ConnectionStatus>().toEqualTypeOf<
      "disconnected" | "connecting" | "connected" | "error"
    >();
  });

  it("exports strict connection health values", () => {
    expectTypeOf<ConnectionHealth>().toEqualTypeOf<
      "healthy" | "degraded" | "down"
    >();
  });

  it("exports strict log levels", () => {
    expectTypeOf<LogLevel>().toEqualTypeOf<
      "error" | "warn" | "info" | "debug"
    >();
  });
});
