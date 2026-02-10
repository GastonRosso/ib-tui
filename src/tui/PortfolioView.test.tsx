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
    dailyPnL: 0,
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
        totalEquity: 0,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: false,
        lastPortfolioUpdateAt: null,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);

    expect(lastFrame()).toContain("Portfolio");
    expect(lastFrame()).toContain("Loading full portfolio...");
  });

  it("renders position rows correctly", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
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

  it("renders header row without Day P&L columns", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("Ticker");
    expect(frame).toContain("Qty");
    expect(frame).toContain("Price");
    expect(frame).toContain("Avg Cost");
    expect(frame).toContain("Unrealized");
    expect(frame).toContain("% Port");
    expect(frame).toContain("Mkt Value");
    expect(frame).not.toContain("Day P&L");
    expect(frame).not.toContain("Day %");
  });

  it("renders summary row with totals", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
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
        totalEquity: 10000,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
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
        totalEquity: 45150,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("AAPL");
    expect(frame).toContain("MSFT");
    expect(frame).toContain("GOOGL");
  });

  it("handles negative unrealized P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            unrealizedPnL: -500,
          }),
        ],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("$-500.00");
  });

  it("handles positive unrealized P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            unrealizedPnL: 1000,
          }),
        ],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("$1,000.00");
  });

  it("shows recency indicator with Updated text", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: now - 5000,
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("Updated");
    expect(frame).toContain("ago");
  });

  it("renders colored countdown to close when market is open", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            marketHours: {
              timeZoneId: "America/New_York",
              liquidHours: "20260210:0930-1600;20260211:0930-1600",
              tradingHours: null,
            },
          }),
        ],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();
    expect(frame).toContain("6h 0m to close");
  });

  it("renders different countdowns for different asset markets at same UTC time", () => {
    // 2026-02-10T15:00:00Z = 10:00 NY (market open) = 00:00+1 Tokyo (market closed)
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [
          createMockPosition({
            conId: 1,
            symbol: "AAPL",
            marketHours: {
              timeZoneId: "America/New_York",
              liquidHours: "20260210:0930-1600;20260211:0930-1600",
              tradingHours: null,
            },
          }),
          createMockPosition({
            conId: 2,
            symbol: "7203",
            marketHours: {
              timeZoneId: "Asia/Tokyo",
              liquidHours: "20260210:0900-1500;20260211:0900-1500",
              tradingHours: null,
            },
          }),
        ],
        totalEquity: 30100,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();
    expect(frame).toContain("6h 0m to close");
    expect(frame).toContain("9h 0m to open");
  });

  it("does not render MarketValueChart", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = {
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).not.toContain("Portfolio Δ since connect");
    expect(frame).not.toContain("Collecting data for chart");
  });
});
