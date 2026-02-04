import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { MarketValueChart } from "./MarketValueChart.js";
import { useStore } from "../state/store.js";

vi.mock("../state/store.js", () => ({
  useStore: vi.fn(),
}));

const mockUseStore = vi.mocked(useStore);

describe("MarketValueChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading state when less than 2 data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100] };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    expect(lastFrame()).toContain("Collecting data for chart...");
  });

  it("renders loading state when no data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [] };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    expect(lastFrame()).toContain("Collecting data for chart...");
  });

  it("renders chart when sufficient data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100, 105, 103, 108, 110] };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    expect(frame).toContain("Portfolio Value");
    expect(frame).not.toContain("Collecting data for chart...");
  });

  it("displays correct time elapsed", () => {
    mockUseStore.mockImplementation((selector) => {
      // 125 data points = 2m 5s
      const state = { marketValueHistory: Array(125).fill(100) };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    expect(frame).toContain("2m 5s");
  });

  it("displays time in minutes and seconds format", () => {
    mockUseStore.mockImplementation((selector) => {
      // 60 data points = 1m 0s
      const state = { marketValueHistory: Array(60).fill(100) };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    expect(frame).toContain("1m 0s");
  });

  it("handles varying data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100, 150, 125, 175, 200, 180] };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    // Chart should render without errors
    expect(frame).toContain("Portfolio Value");
    expect(frame).toContain("0m 6s");
  });
});
