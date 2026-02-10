export type PositionMarketHours = {
  timeZoneId: string | null;
  liquidHours: string | null;
  tradingHours: string | null;
};

export type MarketHoursState = "open" | "closed" | "unknown";

export type MarketHoursStatus = {
  status: MarketHoursState;
  minutesToNextTransition: number | null;
  transition: "open" | "close" | null;
};

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type Window = { startKey: number; endKey: number };

const IB_TZ_ALIASES: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  JST: "Asia/Tokyo",
  HKT: "Asia/Hong_Kong",
  GMT: "Europe/London",
  BST: "Europe/London",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  MET: "Europe/Berlin",
  MEST: "Europe/Berlin",
};

const normalizeTimeZone = (raw: string): string =>
  IB_TZ_ALIASES[raw] ?? raw;

const toLocalParts = (epochMs: number, timeZone: string): LocalParts => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
};

const toMinuteKey = (p: LocalParts): number =>
  Math.floor(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 60_000);

const parseDate = (yyyymmdd: string, hhmm: string): LocalParts => ({
  year: Number(yyyymmdd.slice(0, 4)),
  month: Number(yyyymmdd.slice(4, 6)),
  day: Number(yyyymmdd.slice(6, 8)),
  hour: Number(hhmm.slice(0, 2)),
  minute: Number(hhmm.slice(2, 4)),
});

// Parse "YYYYMMDD:HHMM" into [date, time] parts.
const parseDateTimeToken = (token: string): [string, string] | null => {
  // v970+ format: "20260210:0930" or legacy "0930"
  if (token.includes(":")) {
    const colonIdx = token.indexOf(":");
    return [token.slice(0, colonIdx), token.slice(colonIdx + 1)];
  }
  return null;
};

const parseIbHours = (hours: string): Window[] => {
  const windows: Window[] = [];

  // Formats supported:
  // Legacy:  "20260210:0930-1600;20260211:0930-1600"
  // v970+:   "20260210:0930-20260210:1600;20260211:0930-20260211:1600"
  // Mixed:   "20260210:CLOSED;20260211:0930-1600"
  for (const segment of hours.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // Split only on the FIRST colon to get the day prefix and remainder
    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) continue;

    const day = trimmed.slice(0, firstColon);
    const remainder = trimmed.slice(firstColon + 1);
    if (!day || !remainder || remainder === "CLOSED") continue;

    for (const rawRange of remainder.split(",")) {
      const dashIdx = rawRange.indexOf("-");
      if (dashIdx === -1) continue;

      const startPart = rawRange.slice(0, dashIdx);
      const endPart = rawRange.slice(dashIdx + 1);
      if (!startPart || !endPart) continue;

      // Parse start: could be "0930" (legacy) or "20260210:0930" (v970+)
      const startParsed = parseDateTimeToken(startPart);
      const startDate = startParsed ? startParsed[0] : day;
      const startTime = startParsed ? startParsed[1] : startPart;

      // Parse end: could be "1600" (legacy) or "20260210:1600" (v970+)
      const endParsed = parseDateTimeToken(endPart);
      const endDate = endParsed ? endParsed[0] : day;
      const endTime = endParsed ? endParsed[1] : endPart;

      const startKey = toMinuteKey(parseDate(startDate, startTime));
      const endKey = toMinuteKey(parseDate(endDate, endTime));
      if (endKey > startKey) windows.push({ startKey, endKey });
    }
  }

  return windows.sort((a, b) => a.startKey - b.startKey);
};

export const resolveMarketHours = (
  marketHours: PositionMarketHours | null | undefined,
  nowMs = Date.now()
): MarketHoursStatus => {
  if (!marketHours?.timeZoneId) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const schedule = marketHours.liquidHours ?? marketHours.tradingHours;
  if (!schedule) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const windows = parseIbHours(schedule);
  if (windows.length === 0) {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }

  const timeZone = normalizeTimeZone(marketHours.timeZoneId);

  let nowKey: number;
  try {
    nowKey = toMinuteKey(toLocalParts(nowMs, timeZone));
  } catch {
    return { status: "unknown", minutesToNextTransition: null, transition: null };
  }
  const active = windows.find((w) => nowKey >= w.startKey && nowKey < w.endKey);
  if (active) {
    return {
      status: "open",
      minutesToNextTransition: active.endKey - nowKey,
      transition: "close",
    };
  }

  const next = windows.find((w) => w.startKey > nowKey);
  if (next) {
    return {
      status: "closed",
      minutesToNextTransition: next.startKey - nowKey,
      transition: "open",
    };
  }

  return { status: "closed", minutesToNextTransition: null, transition: null };
};

export const formatMarketHoursCountdown = (session: MarketHoursStatus): string => {
  if (!session.transition || session.minutesToNextTransition === null) return "n/a";
  const hours = Math.floor(session.minutesToNextTransition / 60);
  const minutes = session.minutesToNextTransition % 60;
  return `${hours}h ${minutes}m to ${session.transition}`;
};
