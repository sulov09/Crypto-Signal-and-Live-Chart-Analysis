import { db } from "@/db";
import { alertEvents, signalEvaluations, signalSnapshots, userPreferences } from "@/db/schema";
import { computeSignals, fetchTopCoins } from "@/lib/signal-engine";
import { getCurrentHandle } from "@/lib/session";
import { sendTelegramMessage } from "@/lib/telegram";
import { isTimeframe, type Timeframe } from "@/lib/timeframes";
import { and, desc, eq, gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

function parseTimeframe(value: unknown): Timeframe {
  return isTimeframe(value) ? value : "15m";
}

async function getRiskGuard(handle: string, maxDailyLossPct: number, cooldownAfterLosses: number) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recent = await db
    .select()
    .from(signalEvaluations)
    .where(and(eq(signalEvaluations.userHandle, handle), gte(signalEvaluations.createdAt, since)))
    .orderBy(desc(signalEvaluations.createdAt))
    .limit(40);

  const netR = recent.reduce((s, r) => s + r.pnlR, 0);
  const estimatedLossPct = Math.max(0, -netR);

  let lossStreak = 0;
  for (const row of recent) {
    if (row.outcomeWin === 1) break;
    lossStreak += 1;
  }

  const dailyLossLock = estimatedLossPct >= maxDailyLossPct;
  const cooldownLock = lossStreak >= cooldownAfterLosses;

  return {
    dailyLossLock,
    cooldownLock,
    lossStreak,
    estimatedLossPct: Number(estimatedLossPct.toFixed(2)),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { timeframe?: string };
    const timeframe = parseTimeframe(body.timeframe);

    const coins = await fetchTopCoins(200);
    let signals = computeSignals(coins, timeframe);

    const handle = await getCurrentHandle();
    const prefs = handle
      ? await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) })
      : null;

    const riskGuard =
      handle && prefs
        ? await getRiskGuard(handle, prefs.maxDailyLossPct, prefs.cooldownAfterLosses)
        : { dailyLossLock: false, cooldownLock: false, lossStreak: 0, estimatedLossPct: 0 };

    if (riskGuard.dailyLossLock || riskGuard.cooldownLock) {
      signals = signals.map((s) => ({
        ...s,
        action: "WAIT" as const,
        note: riskGuard.dailyLossLock
          ? "Risk lock active: daily loss limit reached. Pause trading."
          : "Cooldown active: consecutive loss threshold reached.",
        abstainReason: riskGuard.dailyLossLock
          ? "Daily loss lock"
          : "Consecutive loss cooldown",
      }));
    }

    const batchId = crypto.randomUUID();

    if (signals.length > 0) {
      await db.insert(signalSnapshots).values(
        signals.map((signal) => ({
          batchId,
          coinId: signal.coinId,
          symbol: signal.symbol,
          name: signal.name,
          timeframe: signal.timeframe,
          action: signal.action,
          score: Math.round(signal.score),
          probability: Math.round(signal.probability),
          entryPrice: signal.entryPrice,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          riskReward: signal.riskReward,
          note: signal.note,
          factors: signal.factors,
        })),
      );
    }

    const topActionable = signals.find((s) => s.action !== "WAIT" && s.probability >= 78) ?? null;

    let telegramSent = false;
    let insertedAlertId: number | null = null;
    if (topActionable) {
      const inserted = await db
        .insert(alertEvents)
        .values({
          userHandle: handle,
          symbol: topActionable.symbol,
          timeframe: topActionable.timeframe,
          action: topActionable.action,
          probability: Math.round(topActionable.probability),
          message: `${topActionable.symbol} ${topActionable.action} ${topActionable.probability}% on ${topActionable.timeframe}`,
          source: "scan",
          telegramDelivered: false,
        })
        .returning({ id: alertEvents.id });
      insertedAlertId = inserted[0]?.id ?? null;
    }

    if (topActionable && prefs?.telegramEnabled) {
      const msg =
        `🚨 *Signal Alert*\n` +
        `Coin: *${topActionable.symbol}*\n` +
        `Action: *${topActionable.action}*\n` +
        `TF: *${topActionable.timeframe}*\n` +
        `Prob: *${topActionable.probability}%*\n` +
        `Regime: *${topActionable.regime}*\n` +
        `TP-before-SL: *${topActionable.nextMove.tpBeforeSlProb}%*`;

      const sent = await sendTelegramMessage(msg, prefs.telegramChatId);
      telegramSent = sent.ok;

      if (sent.ok && insertedAlertId) {
        await db.update(alertEvents).set({ telegramDelivered: true }).where(eq(alertEvents.id, insertedAlertId));
      }
    }

    return Response.json({
      ok: true,
      batchId,
      scannedCoins: coins.length,
      signals,
      telegramSent,
      generatedAt: new Date().toISOString(),
      riskPolicy: prefs
        ? {
            riskPerTradePct: prefs.riskPerTradePct,
            maxDailyLossPct: prefs.maxDailyLossPct,
            cooldownAfterLosses: prefs.cooldownAfterLosses,
          }
        : null,
      riskGuard,
      disclaimer:
        "Signals are probabilistic and educational. They are not financial advice and do not guarantee outcomes.",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected scan error",
      },
      { status: 500 },
    );
  }
}
