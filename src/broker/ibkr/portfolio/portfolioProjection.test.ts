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
    projection.applyCashBalance("BASE", "5000");

    const snapshot = projection.snapshot();
    expect(snapshot.positionsMarketValue).toBe(15050);
    expect(snapshot.cashBalance).toBe(5000);
    expect(snapshot.cashBalancesByCurrency).toEqual({});
    expect(snapshot.totalEquity).toBe(20050);
  });

  it("tracks per-currency cash balances separately from BASE total", () => {
    const projection = createPortfolioProjection();

    projection.applyCashBalance("USD", "1500.25");
    projection.applyCashBalance("EUR", "700.1");
    projection.applyExchangeRate("USD", "1.00");
    projection.applyExchangeRate("EUR", "1.2");
    projection.applyCashBalance("BASE", "2300.35");

    const snapshot = projection.snapshot();
    expect(snapshot.cashBalance).toBe(2300.35);
    expect(snapshot.cashBalancesByCurrency).toEqual({
      EUR: 840.12,
      USD: 1500.25,
    });
    expect(snapshot.cashExchangeRatesByCurrency).toEqual({
      EUR: 1.2,
      USD: 1,
    });
  });

  it("reconciles non-base converted cash against BASE total when base currency is known", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyExchangeRate("EUR", "1.1906957");
    projection.applyExchangeRate("USD", "1");
    projection.applyCashBalance("EUR", "1189.57");
    projection.applyCashBalance("USD", "34.69");
    projection.applyCashBalance("BASE", "1449.7667");

    const snapshot = projection.snapshot();
    expect(snapshot.cashBalance).toBeCloseTo(1449.7667, 6);
    expect(snapshot.cashBalancesByCurrency.USD).toBeCloseTo(34.69, 6);
    expect(snapshot.cashBalancesByCurrency.EUR).toBeCloseTo(1415.0767, 4);
    expect(snapshot.cashExchangeRatesByCurrency.EUR).toBeCloseTo(1.1906957, 6);
    expect(snapshot.baseCurrencyCode).toBe("USD");
    const convertedTotal = Object.values(snapshot.cashBalancesByCurrency).reduce((sum, value) => sum + value, 0);
    expect(convertedTotal).toBeCloseTo(snapshot.cashBalance, 6);
  });
});
