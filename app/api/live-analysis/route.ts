import { db } from "@/db";
import { streamCandles } from "@/db/schema";
import { analyzeLiveCoin } from "@/lib/live-analysis";
import { streamManager } from "@/lib/stream-manager";
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
    const coin = searchParams.get("coin")?.trim() ?? "BTC";
    const timeframe = parseTimeframe(searchParams.get("timeframe"));

    await streamManager.start(coin, timeframe);
    let cached = streamManager.getCandles(coin, timeframe);

    if (!cached || cached.length < 60) {
      const symbol = normalizePair(coin);
      const rows = await db
        .select()
        .from(streamCandles)
        .where(and(eq(streamCandles.symbol, symbol), eq(streamCandles.timeframe, timeframe)))
        .orderBy(desc(streamCandles.openTime))
        .limit(260);

      if (rows.length) {
        cached = rows
          .reverse()
          .map((r) => ({
            openTime: r.openTime.getTime(),
            closeTime: r.closeTime.getTime(),
            open: r.open,
            high: r.high,
            low: r.low,
            close: r.close,
            volume: r.volume,
            closed: true,
          }));
      }
    }

    const analysis = await analyzeLiveCoin(coin, timeframe, cached?.slice(-260));

    const streamStatus = streamManager.getStatus().find((s) => s.symbol === normalizePair(coin) && s.timeframe === timeframe);

    return Response.json({
      ok: true,
      analysis,
      stream: streamStatus ?? null,
      generatedAt: new Date().toISOString(),
      disclaimer:
        "Live analysis is probabilistic and educational. It does not guarantee outcomes or replace risk management.",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Live analysis failed",
      },
      { status: 500 },
    );
  }
}
