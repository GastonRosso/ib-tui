import { describe, it, expectTypeOf } from "vitest";
import type {
  PortfolioApi,
  PortfolioContractSeed,
  ContractDetailsPayload,
} from "./types.js";

describe("portfolio type contracts", () => {
  it("exports IB boundary types", () => {
    expectTypeOf<PortfolioApi>().toMatchTypeOf<{
      reqAccountUpdates(subscribe: boolean, accountId: string): void;
      reqContractDetails(reqId: number, contract: PortfolioContractSeed): void;
    }>();

    expectTypeOf<ContractDetailsPayload>().toMatchTypeOf<{
      contract?: { conId?: number };
      timeZoneId?: string;
      liquidHours?: string;
      tradingHours?: string;
    }>();
  });
});
