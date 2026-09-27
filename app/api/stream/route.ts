import { streamManager } from "@/lib/stream-manager";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";

export const dynamic = "force-dynamic";

function parseTimeframe(value: unknown): Timeframe {
  return isTimeframe(value) ? value : "15m";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const timeframe = parseTimeframe(searchParams.get("timeframe"));

  if (symbol) {
    const candles = streamManager.getCandles(symbol, timeframe);
    return Response.json({
      ok: true,
      status: streamManager.getStatus(),
      candles: candles?.slice(-220) ?? null,
    });
  }

  return Response.json({ ok: true, status: streamManager.getStatus() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "start" | "stop" | "recover";
      symbol?: string;
      timeframe?: string;
    };

    const action = body.action ?? "start";
    const symbol = (body.symbol ?? "BTCUSDT").trim();
    const timeframe = parseTimeframe(body.timeframe);

    if (!symbol) {
      return Response.json({ ok: false, error: "symbol is required" }, { status: 400 });
    }

    if (action === "stop") {
      const stopped = streamManager.stop(symbol, timeframe);
      return Response.json({ ok: true, stopped, status: streamManager.getStatus() });
    }

    if (action === "recover") {
      streamManager.stop(symbol, timeframe);
      const stream = await streamManager.start(symbol, timeframe);
      return Response.json({
        ok: true,
        recovered: true,
        stream: {
          symbol: stream.symbol,
          timeframe: stream.timeframe,
          status: stream.status,
        },
        status: streamManager.getStatus(),
      });
    }

    const stream = await streamManager.start(symbol, timeframe);
    return Response.json({
      ok: true,
      started: true,
      stream: {
        symbol: stream.symbol,
        timeframe: stream.timeframe,
        status: stream.status,
      },
      status: streamManager.getStatus(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Stream control failed",
      },
      { status: 500 },
    );
  }
}
