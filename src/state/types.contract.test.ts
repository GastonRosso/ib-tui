import { describe, it, expectTypeOf } from "vitest";
import type { ConnectionStatus } from "./types.js";
import type { LogLevel } from "../utils/logger.js";

describe("shared primitive contracts", () => {
  it("exports strict connection statuses", () => {
    expectTypeOf<ConnectionStatus>().toEqualTypeOf<
      "disconnected" | "connecting" | "connected" | "error"
    >();
  });

  it("exports strict log levels", () => {
    expectTypeOf<LogLevel>().toEqualTypeOf<
      "error" | "warn" | "info" | "debug"
    >();
  });
});
