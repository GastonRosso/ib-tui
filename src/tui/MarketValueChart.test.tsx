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
      const state = { marketValueHistory: [100], chartStartTime: null };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    expect(lastFrame()).toContain("Collecting data for chart...");
  });

  it("renders loading state when no data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [], chartStartTime: null };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    expect(lastFrame()).toContain("Collecting data for chart...");
  });

  it("renders chart when sufficient data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100, 105, 103, 108, 110], chartStartTime: Date.now() };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    expect(frame).toContain("Portfolio Value");
    expect(frame).not.toContain("Collecting data for chart...");
  });

  it("displays time format in header", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100, 105], chartStartTime: Date.now() };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    // Should display time format (0m 0s initially)
    expect(frame).toMatch(/Portfolio Value \(\d+m \d+s\)/);
  });

  it("renders ASCII chart with data points", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [100, 150, 125, 175, 200, 180], chartStartTime: Date.now() };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    // Chart should contain axis characters
    expect(frame).toContain("┼");
    expect(frame).toContain("┤");
  });

  it("scales chart to data range", () => {
    mockUseStore.mockImplementation((selector) => {
      const state = { marketValueHistory: [1000, 1050, 1025, 1075], chartStartTime: Date.now() };
      return selector ? selector(state as never) : state;
    });

    const { lastFrame } = render(<MarketValueChart />);
    const frame = lastFrame();

    // Should show values in the 1000 range, not starting from 0
    expect(frame).toContain("1000.00");
    expect(frame).toContain("1075.00");
  });
});
