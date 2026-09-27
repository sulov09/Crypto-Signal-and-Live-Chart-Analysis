export const TIMEFRAMES = ["5m", "15m", "30m", "1h", "4h", "6h", "1d", "1w"] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);
}
