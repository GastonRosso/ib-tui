import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { PortfolioView } from "./PortfolioView.js";
import { useStore } from "../state/store.js";
import type { Position } from "../broker/types.js";

const mockUnsubscribe = vi.fn();
const mockSubscribe = vi.fn(() => mockUnsubscribe);

vi.mock("../state/store.js", () => ({
  useStore: vi.fn(),
}));

const mockUseStore = vi.mocked(useStore);

describe("PortfolioView", () => {
  const createMockPosition = (overrides: Partial<Position> = {}): Position => ({
    symbol: "AAPL",
    quantity: 100,
    avgCost: 145.0,
    marketValue: 15050,
    unrealizedPnL: 550,
    dailyPnL: 75.25,
    realizedPnL: 0,
    marketPrice: 150.5,
    currency: "USD",
    conId: 265598,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnsubscribe.mockClear();
    mockSubscribe.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state when no positions", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [] as Position[],
        totalPortfolioValue: 0,
        accountDailyPnL: 0,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);

    expect(lastFrame()).toContain("Portfolio");
    expect(lastFrame()).toContain("Loading positions...");
  });

  it("renders position rows correctly", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalPortfolioValue: 15050,
        accountDailyPnL: 75.25,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("AAPL");
    expect(frame).toContain("100");
    expect(frame).toContain("$145.00");
    expect(frame).toContain("$15,050.00");
  });

  it("renders header row", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalPortfolioValue: 15050,
        accountDailyPnL: 75.25,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("Ticker");
    expect(frame).toContain("Qty");
    expect(frame).toContain("Price");
    expect(frame).toContain("Avg Cost");
    expect(frame).toContain("Day P&L");
    expect(frame).toContain("Unrealized");
    expect(frame).toContain("% Port");
  });

  it("renders summary row with totals", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalPortfolioValue: 15050,
        accountDailyPnL: 75.25,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("TOTAL");
    expect(frame).toContain("100.0%");
  });

  it("calculates portfolio percentage correctly", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({ conId: 1, symbol: "AAPL", marketValue: 7500 }),
          createMockPosition({ conId: 2, symbol: "MSFT", marketValue: 2500 }),
        ],
        totalPortfolioValue: 10000,
        accountDailyPnL: 100,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("75.0%");
    expect(frame).toContain("25.0%");
  });

  it("renders multiple positions", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({ conId: 1, symbol: "AAPL" }),
          createMockPosition({ conId: 2, symbol: "MSFT" }),
          createMockPosition({ conId: 3, symbol: "GOOGL" }),
        ],
        totalPortfolioValue: 45150,
        accountDailyPnL: 225.75,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("AAPL");
    expect(frame).toContain("MSFT");
    expect(frame).toContain("GOOGL");
  });

  it("handles negative P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            dailyPnL: -150.5,
            unrealizedPnL: -500,
          }),
        ],
        totalPortfolioValue: 15050,
        accountDailyPnL: -150.5,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    // The format is $-150.50 not -$150.50
    expect(frame).toContain("$-150.50");
    expect(frame).toContain("$-500.00");
  });

  it("handles positive P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            dailyPnL: 250.0,
            unrealizedPnL: 1000,
          }),
        ],
        totalPortfolioValue: 15050,
        accountDailyPnL: 250.0,
        cashBalance: 0,
        marketValueHistory: [],
        chartStartTime: null,
        subscribePortfolio: mockSubscribe,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("$250.00");
    expect(frame).toContain("$1,000.00");
  });
});
