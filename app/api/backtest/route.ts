import { db } from "@/db";
import { backtestReports, signalEvaluations } from "@/db/schema";
import { runBacktest } from "@/lib/backtest";
import { getCurrentHandle } from "@/lib/session";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";

export const dynamic = "force-dynamic";

function parseTimeframe(value: unknown): Timeframe {
  return isTimeframe(value) ? value : "15m";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const coin = (searchParams.get("coin") ?? "BTC").trim();
    const timeframe = parseTimeframe(searchParams.get("timeframe"));
    const lookback = Math.min(Math.max(Number(searchParams.get("lookback") ?? 250), 120), 700);

    const report = await runBacktest(coin, timeframe, lookback);
    const handle = await getCurrentHandle();

    await db.insert(backtestReports).values({
      userHandle: handle,
      symbol: report.pair,
      timeframe,
      lookback,
      trades: report.trades,
      winRate: report.winRate,
      netR: report.netR,
      maxDrawdownR: report.maxDrawdownR,
      payload: report as unknown as Record<string, unknown>,
    });

    if (report.recentTrades.length) {
      await db.insert(signalEvaluations).values(
        report.recentTrades.map((t) => ({
          userHandle: handle,
          symbol: report.pair,
          timeframe,
          action: t.side === "LONG" ? "BUY" : "SELL",
          regime: t.regime,
          source: "backtest",
          predictedProbability: t.predictedProbability,
          outcomeWin: t.outcome === "WIN" ? 1 : 0,
          pnlR: t.resultR,
        })),
      );
    }

    return Response.json({ ok: true, report, generatedAt: new Date().toISOString() });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Backtest failed" },
      { status: 500 },
    );
  }
}
