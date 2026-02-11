import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { PortfolioView } from "./PortfolioView.js";
import { useStore } from "../state/store.js";
import type { AppState } from "../state/store.js";
import type { Broker } from "../broker/types.js";
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
    marketValueBase: 15050,
    unrealizedPnLBase: 550,
    fxRateToBase: 1,
    isFxPending: false,
    ...overrides,
  });

  const createMockBroker = (): Broker => ({
    connect: async () => undefined,
    disconnect: async () => undefined,
    isConnected: () => true,
    onDisconnect: () => () => {},
    onStatus: () => () => {},
    getAccountSummary: async () => ({
      accountId: "DU123456",
      netLiquidation: 0,
      totalCashValue: 0,
      buyingPower: 0,
      positions: [],
    }),
    getPositions: async () => [],
    placeOrder: async (order) => ({ ...order, id: 1, status: "Submitted" }),
    cancelOrder: async () => undefined,
    getOpenOrders: async () => [],
    subscribeQuote: () => () => {},
    subscribePortfolio: () => () => {},
  });

  const createBaseState = (): AppState => ({
    broker: createMockBroker(),
    connectionStatus: "connected",
    error: null,
    brokerStatus: null,
    positions: [],
    positionsMarketValue: 0,
    positionsUnrealizedPnL: 0,
    totalEquity: 0,
    cashBalance: 0,
    cashBalancesByCurrency: {},
    cashExchangeRatesByCurrency: {},
    baseCurrencyCode: null,
    initialLoadComplete: true,
    lastPortfolioUpdateAt: Date.now(),
    positionsPendingFxCount: 0,
    positionsPendingFxByCurrency: {},
    displayCurrencyPreference: "BASE",
    displayCurrencyCode: null,
    displayFxRate: 1,
    availableDisplayCurrencies: [],
    displayCurrencyWarning: null,
    connect: async () => undefined,
    disconnect: async () => undefined,
    setConnectionStatus: () => {},
    setError: () => {},
    subscribePortfolio: mockSubscribe,
    setDisplayCurrencyPreference: () => {},
    cycleDisplayCurrency: () => {},
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
      const state: AppState = {
        ...createBaseState(),
        positions: [],
        totalEquity: 0,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: false,
        lastPortfolioUpdateAt: null,
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);

    expect(lastFrame()).toContain("Portfolio");
    expect(lastFrame()).toContain("Loading full portfolio...");
  });

  it("renders position rows correctly", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("AAPL");
    expect(frame).toContain("100");
    expect(frame).toContain("$145.00");
    expect(frame).toContain("$15,050.00");
  });

  it("renders CCY column header and position currency", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        positionsMarketValue: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("CCY");
    expect(frame).toContain("USD");
  });

  it("shows pending for market value when FX is pending", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [
          createMockPosition({
            conId: 100,
            symbol: "SAP",
            currency: "EUR",
            marketValue: 10000,
            marketValueBase: null,
            unrealizedPnLBase: null,
            fxRateToBase: null,
            isFxPending: true,
          }),
        ],
        baseCurrencyCode: "USD",
        totalEquity: 0,
        positionsMarketValue: 0,
        positionsPendingFxCount: 1,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("pending");
    expect(frame).toContain("SAP");
    expect(frame).toContain("EUR");
    expect(frame).toContain("pending FX");
  });

  it("renders header row without Day P&L columns", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

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
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Pos Tot");
    expect(frame).toContain("100.0%");
  });

  it("calculates portfolio percentage correctly", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [
          createMockPosition({ conId: 1, symbol: "AAPL", marketValue: 7500, marketValueBase: 7500 }),
          createMockPosition({ conId: 2, symbol: "MSFT", marketValue: 2500, marketValueBase: 2500 }),
        ],
        positionsMarketValue: 10000,
        totalEquity: 10000,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("75.0%");
    expect(frame).toContain("25.0%");
  });

  it("renders multiple positions", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
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
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("AAPL");
    expect(frame).toContain("MSFT");
    expect(frame).toContain("GOOGL");
  });

  it("handles negative unrealized P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [
          createMockPosition({
            unrealizedPnL: -500,
            unrealizedPnLBase: -500,
          }),
        ],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("$-500.00");
  });

  it("handles positive unrealized P&L values", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [
          createMockPosition({
            unrealizedPnL: 1000,
            unrealizedPnLBase: 1000,
          }),
        ],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("$1,000.00");
  });

  it("shows recency indicator with Updated text", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: now - 5000,
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).toContain("Updated");
    expect(frame).toContain("ago");
  });

  it("renders colored countdown to close when market is open", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
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
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();
    expect(frame).toContain("6h 0m to close");
  });

  it("renders different countdowns for different asset markets at same UTC time", () => {
    // 2026-02-10T15:00:00Z = 10:00 NY (market open) = 00:00+1 Tokyo (market closed)
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-02-10T15:00:00.000Z"));
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
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
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();
    expect(frame).toContain("6h 0m to close");
    expect(frame).toContain("9h 0m to open");
  });

  it("does not render MarketValueChart", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 15050,
        cashBalance: 0,
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame();

    expect(frame).not.toContain("Portfolio Δ since connect");
    expect(frame).not.toContain("Collecting data for chart");
  });

  it("renders cash holdings grouped by currency codes", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 17050,
        cashBalance: 2000,
        cashBalancesByCurrency: { EUR: 500, USD: 1500 },
        cashExchangeRatesByCurrency: { EUR: 1.2, USD: 1 },
        baseCurrencyCode: "USD",
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Cash");
    expect(frame).toContain("CCY");
    expect(frame).toContain("FX Rate");
    expect(frame).toContain("Pos Tot");
    expect(frame).toContain("Cash Tot");
    expect(frame).toContain("Tot");
    expect(frame).toContain("EUR");
    expect(frame).toContain("USD");
    expect(frame).toContain("1.2000");
    expect(frame).toContain("500.00");
    expect(frame).toContain("1,500.00");
  });

  it("renders an extra divider between assets and cash holdings", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 17050,
        cashBalance: 2000,
        cashBalancesByCurrency: { USD: 2000 },
        cashExchangeRatesByCurrency: { USD: 1 },
        baseCurrencyCode: "USD",
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";
    const separatorRows = frame
      .split("\n")
      .filter((line) => line.includes("─"))
      .length;

    expect(separatorRows).toBeGreaterThanOrEqual(2);
  });

  it("falls back to BASE cash row when no per-currency cash balances are present", () => {
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [createMockPosition()],
        totalEquity: 16250,
        cashBalance: 1200,
        cashBalancesByCurrency: {},
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("Cash");
    expect(frame).toContain("BASE");
    expect(frame).toContain("$1,200.00");
  });

  it("converts numeric values when display currency differs from base", () => {
    // Base is USD, display is EUR with displayFxRate = 1/1.1 ≈ 0.9091
    // Position: marketValueBase=15050 USD → displayed as 15050 * (1/1.1) ≈ 13681.82
    // Cash: 5000 USD → displayed as 5000 * (1/1.1) ≈ 4545.45
    // Total: 20050 USD → displayed as 20050 * (1/1.1) ≈ 18227.27
    const displayFxRate = 1 / 1.1;
    mockUseStore.mockImplementation((selector) => {
      const state: AppState = {
        ...createBaseState(),
        positions: [
          createMockPosition({
            marketValue: 15050,
            marketValueBase: 15050,
            unrealizedPnL: 550,
            unrealizedPnLBase: 550,
          }),
        ],
        positionsMarketValue: 15050,
        positionsUnrealizedPnL: 550,
        totalEquity: 20050,
        cashBalance: 5000,
        cashBalancesByCurrency: { USD: 5000 },
        cashExchangeRatesByCurrency: { EUR: 1.1, USD: 1 },
        baseCurrencyCode: "USD",
        displayCurrencyCode: "EUR",
        displayFxRate,
        availableDisplayCurrencies: ["EUR", "USD"],
        subscribePortfolio: mockSubscribe,
        initialLoadComplete: true,
        lastPortfolioUpdateAt: Date.now(),
      };
      return selector ? selector(state) : state;
    });

    const { lastFrame } = render(<PortfolioView />);
    const frame = lastFrame() ?? "";

    // Position market value: 15050 * (1/1.1) = 13681.818...
    expect(frame).toContain("€13,681.82");
    // Total equity: 20050 * (1/1.1) = 18227.272...
    expect(frame).toContain("€18,227.27");
    // Cash: 5000 * (1/1.1) = 4545.454...
    expect(frame).toContain("€4,545.45");
    // Unrealized PnL: 550 * (1/1.1) = 500.00
    expect(frame).toContain("€500.00");
    // Display currency label should show EUR
    expect(frame).toContain("Display:");
    expect(frame).toContain("EUR");
  });
});
