import { computeSingleCoinSignal, fetchTopCoins } from "@/lib/signal-engine";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";

export const dynamic = "force-dynamic";

function parseTimeframe(value: string | null): Timeframe {
  return isTimeframe(value) ? value : "15m";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coin = searchParams.get("coin")?.trim() ?? "";
    const timeframe = parseTimeframe(searchParams.get("timeframe"));

    if (!coin) {
      return Response.json({ ok: false, error: "coin query parameter is required" }, { status: 400 });
    }

    const coins = await fetchTopCoins(200);
    const signal = computeSingleCoinSignal(coins, coin, timeframe);

    if (!signal) {
      return Response.json(
        {
          ok: false,
          error: "Coin not found in current top-200 market-cap universe",
        },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      signal,
      generatedAt: new Date().toISOString(),
      disclaimer:
        "This is a quantitative probability model for education only. Trade decisions remain your responsibility.",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected search error",
      },
      { status: 500 },
    );
  }
}
