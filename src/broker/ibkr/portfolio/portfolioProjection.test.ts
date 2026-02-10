import { describe, expect, it } from "vitest";
import { createPortfolioProjection } from "./portfolioProjection.js";

describe("createPortfolioProjection", () => {
  it("builds totalEquity from positionsMarketValue + cashBalance", () => {
    const projection = createPortfolioProjection();

    projection.applyPortfolioUpdate({
      contract: { conId: 265598, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150.5,
      marketValue: 15050,
      avgCost: 145,
      unrealizedPnL: 550,
      realizedPnL: 0,
    });
    projection.applyCashBalance("5000");

    const snapshot = projection.snapshot();
    expect(snapshot.positionsMarketValue).toBe(15050);
    expect(snapshot.cashBalance).toBe(5000);
    expect(snapshot.totalEquity).toBe(20050);
  });
});
