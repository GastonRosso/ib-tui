import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { Text } from "ink";
import type { Key } from "ink";
import type { Broker } from "../broker/types.js";
import { App } from "./App.js";
import { useStore } from "../state/store.js";
import type { AppState } from "../state/store.js";

type InkMockControls = {
  inputHandler: ((input: string, key: Key) => void) | null;
  exitMock: ReturnType<typeof vi.fn>;
};

const inkMockControls = vi.hoisted<InkMockControls>(() => ({
  inputHandler: null,
  exitMock: vi.fn(),
}));

vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: (handler: (input: string, key: Key) => void) => {
      inkMockControls.inputHandler = handler;
    },
    useApp: () => ({ exit: inkMockControls.exitMock }),
  };
});

vi.mock("./PortfolioView.js", async () => {
  const ReactModule = await import("react");

  return {
    STALE_THRESHOLD_MS: 180_000,
    PortfolioView: () =>
      ReactModule.createElement(Text, null, "PortfolioViewMock"),
  };
});

vi.mock("../state/store.js", () => ({
  useStore: vi.fn(),
}));

const mockUseStore = vi.mocked(useStore);
const createKey = (overrides: Partial<Key> = {}): Key => ({
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  ...overrides,
});
const EMPTY_KEY = createKey();
const UP_KEY = createKey({ upArrow: true });
const DOWN_KEY = createKey({ downArrow: true });

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

const createState = (overrides: Partial<AppState> = {}): AppState => ({
  broker: createMockBroker(),
  connectionStatus: "connected",
  connectionHealth: "healthy",
  error: null,
  brokerStatus: null,
  retryAttempt: 0,
  nextRetryAt: null,
  statusHistory: [],
  statusHistoryIndex: 0,
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
  displayCurrencyCode: "USD",
  displayFxRate: 1,
  availableDisplayCurrencies: ["USD"],
  displayCurrencyWarning: null,
  connect: async () => undefined,
  disconnect: async () => undefined,
  startAutoConnect: () => {},
  stopAutoConnect: () => {},
  selectOlderStatus: () => {},
  selectNewerStatus: () => {},
  setConnectionStatus: () => {},
  setError: () => {},
  subscribePortfolio: () => () => {},
  setDisplayCurrencyPreference: () => {},
  cycleDisplayCurrency: () => {},
  ...overrides,
});

describe("App", () => {
  let currentState: AppState;

  beforeEach(() => {
    vi.clearAllMocks();
    inkMockControls.inputHandler = null;
    inkMockControls.exitMock = vi.fn();
    currentState = createState();
    mockUseStore.mockImplementation((selector) =>
      selector ? selector(currentState) : currentState,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts auto-connect on mount", async () => {
    const startAutoConnect = vi.fn();
    currentState = createState({ startAutoConnect });

    const app = render(<App />);
    await vi.waitFor(() => {
      expect(startAutoConnect).toHaveBeenCalledTimes(1);
    });
    app.unmount();
  });

  it("does not reconnect on 'c' key", () => {
    const connect = vi.fn(async () => undefined);
    currentState = createState({ connect });
    const app = render(<App />);
    app.stdin.write("c");

    expect(connect).not.toHaveBeenCalled();
    app.unmount();
  });

  it("changes focused panel using 1/2/3 keys", async () => {
    const app = render(<App />);

    expect(app.lastFrame()).toContain(">[1] Status<");

    expect(inkMockControls.inputHandler).not.toBeNull();
    inkMockControls.inputHandler?.("2", EMPTY_KEY);
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain("[1] Status |");
      expect(app.lastFrame()).not.toContain(">[1] Status<");
    });

    inkMockControls.inputHandler?.("3", EMPTY_KEY);
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain("[1] Status |");
      expect(app.lastFrame()).not.toContain(">[1] Status<");
    });

    inkMockControls.inputHandler?.("1", EMPTY_KEY);
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain(">[1] Status<");
    });

    app.unmount();
  });

  it("navigates status history with arrows only when status panel is focused", async () => {
    const selectOlderStatus = vi.fn();
    const selectNewerStatus = vi.fn();
    currentState = createState({
      selectOlderStatus,
      selectNewerStatus,
      statusHistory: [
        {
          at: Date.now(),
          level: "error",
          message: "Connectivity lost",
          code: 1100,
          repeatCount: 1,
        },
      ],
      statusHistoryIndex: 0,
    });

    const app = render(<App />);
    expect(inkMockControls.inputHandler).not.toBeNull();

    inkMockControls.inputHandler?.("2", EMPTY_KEY);
    await vi.waitFor(() => {
      expect(app.lastFrame()).not.toContain(">[1] Status<");
    });
    inkMockControls.inputHandler?.("", UP_KEY);
    inkMockControls.inputHandler?.("", DOWN_KEY);
    expect(selectOlderStatus).not.toHaveBeenCalled();
    expect(selectNewerStatus).not.toHaveBeenCalled();

    inkMockControls.inputHandler?.("1", EMPTY_KEY);
    inkMockControls.inputHandler?.("", UP_KEY);
    inkMockControls.inputHandler?.("", DOWN_KEY);
    await vi.waitFor(() => {
      expect(selectOlderStatus).toHaveBeenCalledTimes(1);
      expect(selectNewerStatus).toHaveBeenCalledTimes(1);
    });

    app.unmount();
  });

  it("renders top line with transport, health, data age, and retry", () => {
    currentState = createState({
      connectionStatus: "connected",
      connectionHealth: "degraded",
      lastPortfolioUpdateAt: Date.now() - 5_000,
      retryAttempt: 2,
      nextRetryAt: Date.now() + 4_000,
      statusHistory: [
        {
          at: Date.now() - 2_000,
          level: "error",
          message: "Connectivity lost",
          code: 1100,
          repeatCount: 1,
        },
      ],
      statusHistoryIndex: 0,
    });

    const app = render(<App />);
    const frame = app.lastFrame() ?? "";

    expect(frame).toContain("transport:");
    expect(frame).toContain("connected");
    expect(frame).toContain("health:");
    expect(frame).toContain("degraded");
    expect(frame).toContain("data:");
    expect(frame).toContain("retry: #2 in");
    expect(frame).toContain("[1] Status");
    expect(frame).not.toContain("[2] Portfolio |");
    expect(frame).not.toContain("[3] Cash |");

    app.unmount();
  });
});
