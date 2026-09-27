import { db } from "@/db";
import { streamCandles } from "@/db/schema";
import { simulateReplay } from "@/lib/replay-simulator";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";
import { and, desc, eq } from "drizzle-orm";

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
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 320), 120), 1200);

    const rows = await db
      .select()
      .from(streamCandles)
      .where(and(eq(streamCandles.symbol, symbol), eq(streamCandles.timeframe, timeframe)))
      .orderBy(desc(streamCandles.openTime))
      .limit(limit);

    const candles = rows.reverse().map((r) => ({
      openTime: r.openTime,
      closeTime: r.closeTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));

    if (candles.length < 80) {
      return Response.json(
        {
          ok: false,
          error: "Not enough persisted candles yet. Keep stream running and retry.",
        },
        { status: 400 },
      );
    }

    const simulation = simulateReplay(candles);

    return Response.json({
      ok: true,
      symbol,
      timeframe,
      candles: candles.map((c) => ({
        openTime: c.openTime.toISOString(),
        closeTime: c.closeTime.toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      simulation,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Replay simulation failed",
      },
      { status: 500 },
    );
  }
}
