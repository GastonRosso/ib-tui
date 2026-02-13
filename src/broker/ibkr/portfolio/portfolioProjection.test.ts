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

  it("tracks per-currency cash balances using FX-converted local cash", () => {
    const projection = createPortfolioProjection();

    projection.applyCashBalance("USD", "1500.25");
    projection.applyCashBalance("EUR", "700.1");
    projection.applyExchangeRate("USD", "1.00");
    projection.applyExchangeRate("EUR", "1.2");
    projection.applyCashBalance("BASE", "2300.35");

    const snapshot = projection.snapshot();
    expect(snapshot.cashBalance).toBeCloseTo(2340.37, 6);
    expect(snapshot.cashBalancesByCurrency).toEqual({
      EUR: 840.12,
      USD: 1500.25,
    });
    expect(snapshot.cashExchangeRatesByCurrency).toEqual({
      EUR: 1.2,
      USD: 1,
    });
  });

  it("uses FX-converted local cash directly instead of reconciling to BASE total", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyExchangeRate("EUR", "1.1906957");
    projection.applyExchangeRate("USD", "1");
    projection.applyCashBalance("EUR", "1189.57");
    projection.applyCashBalance("USD", "34.69");
    projection.applyCashBalance("BASE", "1449.7667");

    const snapshot = projection.snapshot();
    expect(snapshot.cashBalance).toBeCloseTo(1451.105883849, 6);
    expect(snapshot.cashBalancesByCurrency.USD).toBeCloseTo(34.69, 6);
    expect(snapshot.cashBalancesByCurrency.EUR).toBeCloseTo(1416.415883849, 6);
    expect(snapshot.cashExchangeRatesByCurrency.EUR).toBeCloseTo(1.1906957, 6);
    expect(snapshot.baseCurrencyCode).toBe("USD");

    projection.applyExchangeRate("EUR", "1.2000000");
    const afterFxMove = projection.snapshot();
    expect(afterFxMove.cashBalancesByCurrency.EUR).toBeCloseTo(1427.484, 3);
    expect(afterFxMove.cashBalance).toBeCloseTo(1462.174, 3);
  });

  it("marks EUR position as pending before FX arrives in USD-base account", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyPortfolioUpdate({
      contract: { conId: 100, symbol: "SAP", currency: "EUR" },
      pos: 50,
      marketPrice: 200,
      marketValue: 10000,
      avgCost: 180,
      unrealizedPnL: 1000,
    });

    const snapshot = projection.snapshot();
    const sap = snapshot.positions.find((p) => p.conId === 100);
    if (!sap) throw new Error("expected SAP position");
    expect(sap.isFxPending).toBe(true);
    expect(sap.marketValueBase).toBeNull();
    expect(sap.unrealizedPnLBase).toBeNull();
    expect(sap.fxRateToBase).toBeNull();
    expect(snapshot.positionsMarketValue).toBe(0);
    expect(snapshot.positionsPendingFxCount).toBe(1);
    expect(snapshot.positionsPendingFxByCurrency).toEqual({ EUR: 10000 });
  });

  it("resolves pending EUR position when FX arrives", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyPortfolioUpdate({
      contract: { conId: 100, symbol: "SAP", currency: "EUR" },
      pos: 50,
      marketPrice: 200,
      marketValue: 10000,
      avgCost: 180,
      unrealizedPnL: 1000,
    });

    // FX arrives
    projection.applyExchangeRate("EUR", "1.1");

    const snapshot = projection.snapshot();
    const sap = snapshot.positions.find((p) => p.conId === 100);
    if (!sap) throw new Error("expected SAP position");
    expect(sap.isFxPending).toBe(false);
    expect(sap.marketValueBase).toBeCloseTo(11000, 6);
    expect(sap.unrealizedPnLBase).toBeCloseTo(1100, 6);
    expect(sap.fxRateToBase).toBeCloseTo(1.1, 6);
    expect(snapshot.positionsMarketValue).toBeCloseTo(11000, 6);
    expect(snapshot.positionsPendingFxCount).toBe(0);
    expect(snapshot.positionsPendingFxByCurrency).toEqual({});
  });

  it("aggregates mixed-currency positions correctly in base", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyExchangeRate("EUR", "1.1");

    // USD position
    projection.applyPortfolioUpdate({
      contract: { conId: 1, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150,
      marketValue: 15000,
      avgCost: 140,
      unrealizedPnL: 1000,
    });

    // EUR position
    projection.applyPortfolioUpdate({
      contract: { conId: 2, symbol: "SAP", currency: "EUR" },
      pos: 50,
      marketPrice: 200,
      marketValue: 10000,
      avgCost: 180,
      unrealizedPnL: 1000,
    });

    const snapshot = projection.snapshot();
    expect(snapshot.positionsMarketValue).toBeCloseTo(15000 + 11000, 6);
    expect(snapshot.positionsUnrealizedPnL).toBeCloseTo(1000 + 1100, 6);
    expect(snapshot.positionsPendingFxCount).toBe(0);
  });

  it("base-currency positions get fxRate=1 with no pending state", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyPortfolioUpdate({
      contract: { conId: 1, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150,
      marketValue: 15000,
      avgCost: 140,
      unrealizedPnL: 1000,
    });

    const snapshot = projection.snapshot();
    const aapl = snapshot.positions.find((p) => p.conId === 1);
    if (!aapl) throw new Error("expected AAPL position");
    expect(aapl.fxRateToBase).toBe(1);
    expect(aapl.isFxPending).toBe(false);
    expect(aapl.marketValueBase).toBe(15000);
    expect(aapl.unrealizedPnLBase).toBe(1000);
  });

  it("positions default to fxRate=1 when base currency is not yet known", () => {
    const projection = createPortfolioProjection();

    projection.applyPortfolioUpdate({
      contract: { conId: 1, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150,
      marketValue: 15000,
      avgCost: 140,
      unrealizedPnL: 1000,
    });

    const snapshot = projection.snapshot();
    const aapl = snapshot.positions.find((p) => p.conId === 1);
    if (!aapl) throw new Error("expected AAPL position");
    expect(aapl.fxRateToBase).toBe(1);
    expect(aapl.isFxPending).toBe(false);
    expect(aapl.marketValueBase).toBe(15000);
  });

  it("includes positionsUnrealizedPnL in snapshot", () => {
    const projection = createPortfolioProjection();

    projection.setBaseCurrency("USD");
    projection.applyPortfolioUpdate({
      contract: { conId: 1, symbol: "AAPL", currency: "USD" },
      pos: 100,
      marketPrice: 150,
      marketValue: 15000,
      avgCost: 140,
      unrealizedPnL: 1000,
    });

    const snapshot = projection.snapshot();
    expect(snapshot.positionsUnrealizedPnL).toBe(1000);
  });
});
