import { describe, it, expect } from "vitest";
import { parseCliArgs, parsePortfolioCurrency } from "./cliArgs.js";

describe("parsePortfolioCurrency", () => {
  it("accepts BASE", () => {
    expect(parsePortfolioCurrency("BASE")).toBe("BASE");
  });

  it("normalizes lowercase to uppercase", () => {
    expect(parsePortfolioCurrency("usd")).toBe("USD");
    expect(parsePortfolioCurrency("eur")).toBe("EUR");
    expect(parsePortfolioCurrency("base")).toBe("BASE");
  });

  it("accepts valid 3-letter currency codes", () => {
    expect(parsePortfolioCurrency("USD")).toBe("USD");
    expect(parsePortfolioCurrency("EUR")).toBe("EUR");
    expect(parsePortfolioCurrency("GBP")).toBe("GBP");
    expect(parsePortfolioCurrency("JPY")).toBe("JPY");
  });

  it("rejects invalid values", () => {
    expect(() => parsePortfolioCurrency("")).toThrow();
    expect(() => parsePortfolioCurrency("US")).toThrow();
    expect(() => parsePortfolioCurrency("USDX")).toThrow();
    expect(() => parsePortfolioCurrency("123")).toThrow();
    expect(() => parsePortfolioCurrency("U1D")).toThrow();
  });
});

describe("parseCliArgs", () => {
  it("returns null portfolioCurrency when flag is not present", () => {
    const result = parseCliArgs(["--log-file", "--log-level=debug"]);
    expect(result.portfolioCurrency).toBeNull();
  });

  it("parses valid --portfolio-currency=USD", () => {
    const result = parseCliArgs(["--portfolio-currency=USD"]);
    expect(result.portfolioCurrency).toBe("USD");
  });

  it("parses --portfolio-currency=BASE", () => {
    const result = parseCliArgs(["--portfolio-currency=BASE"]);
    expect(result.portfolioCurrency).toBe("BASE");
  });

  it("normalizes lowercase currency code", () => {
    const result = parseCliArgs(["--portfolio-currency=eur"]);
    expect(result.portfolioCurrency).toBe("EUR");
  });

  it("throws on bare --portfolio-currency flag without value", () => {
    expect(() => parseCliArgs(["--portfolio-currency"])).toThrow(
      '--portfolio-currency'
    );
  });

  it("throws on empty value", () => {
    expect(() => parseCliArgs(["--portfolio-currency="])).toThrow();
  });

  it("throws on invalid currency code", () => {
    expect(() => parseCliArgs(["--portfolio-currency=ABCD"])).toThrow();
  });
});
