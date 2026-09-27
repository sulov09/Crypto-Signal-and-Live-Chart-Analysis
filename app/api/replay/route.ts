import { db } from "@/db";
import { streamCandles } from "@/db/schema";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

export const dynamic = "force-dynamic";

function parseTimeframe(value: string | null): Timeframe {
  return isTimeframe(value) ? value : "15m";
}

function normalizePair(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = normalizePair(searchParams.get("symbol") ?? "BTCUSDT");
    const timeframe = parseTimeframe(searchParams.get("timeframe"));
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 240), 20), 1000);

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");

    const filters = [eq(streamCandles.symbol, symbol), eq(streamCandles.timeframe, timeframe)];

    if (fromParam) {
      const fromDate = new Date(fromParam);
      if (!Number.isNaN(fromDate.getTime())) {
        filters.push(gte(streamCandles.openTime, fromDate));
      }
    }

    if (toParam) {
      const toDate = new Date(toParam);
      if (!Number.isNaN(toDate.getTime())) {
        filters.push(lte(streamCandles.openTime, toDate));
      }
    }

    const rows = await db
      .select()
      .from(streamCandles)
      .where(and(...filters))
      .orderBy(desc(streamCandles.openTime))
      .limit(limit);

    const candles = rows
      .reverse()
      .map((r) => ({
        openTime: r.openTime.toISOString(),
        closeTime: r.closeTime.toISOString(),
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        source: r.source,
      }));

    const latest = await db
      .select({ openTime: streamCandles.openTime })
      .from(streamCandles)
      .where(and(eq(streamCandles.symbol, symbol), eq(streamCandles.timeframe, timeframe)))
      .orderBy(desc(streamCandles.openTime))
      .limit(1);

    const earliest = await db
      .select({ openTime: streamCandles.openTime })
      .from(streamCandles)
      .where(and(eq(streamCandles.symbol, symbol), eq(streamCandles.timeframe, timeframe)))
      .orderBy(asc(streamCandles.openTime))
      .limit(1);

    return Response.json({
      ok: true,
      symbol,
      timeframe,
      count: candles.length,
      candles,
      coverage: {
        earliest: earliest[0]?.openTime?.toISOString() ?? null,
        latest: latest[0]?.openTime?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Replay fetch failed" },
      { status: 500 },
    );
  }
}
