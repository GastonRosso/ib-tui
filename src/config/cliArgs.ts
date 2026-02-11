import type { DisplayCurrencyPreference } from "../state/store.js";

export type CliArgs = {
  portfolioCurrency: DisplayCurrencyPreference | null;
};

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

export const parsePortfolioCurrency = (raw: string): DisplayCurrencyPreference => {
  const normalized = raw.toUpperCase();
  if (normalized === "BASE") return "BASE";
  if (CURRENCY_CODE_RE.test(normalized)) return normalized;
  throw new Error(`Invalid --portfolio-currency value "${raw}". Use "BASE" or a 3-letter currency code (e.g., USD, EUR).`);
};

export const parseCliArgs = (argv: string[]): CliArgs => {
  const portfolioCurrencyArg = argv.find((arg) => arg.startsWith("--portfolio-currency="));
  const hasBareFlag = argv.includes("--portfolio-currency");

  if (hasBareFlag && !portfolioCurrencyArg) {
    throw new Error('Invalid "--portfolio-currency" usage. Use "--portfolio-currency=<BASE|CCC>".');
  }

  let portfolioCurrency: DisplayCurrencyPreference | null = null;
  if (portfolioCurrencyArg) {
    const raw = portfolioCurrencyArg.slice("--portfolio-currency=".length);
    if (!raw.trim()) {
      throw new Error('Invalid "--portfolio-currency" value. Provide "BASE" or a 3-letter currency code.');
    }
    portfolioCurrency = parsePortfolioCurrency(raw);
  }

  return { portfolioCurrency };
};
