import SignalDashboard from "@/components/signal-dashboard";
import { db } from "@/db";
import { signalSnapshots, userPreferences } from "@/db/schema";
import type { Timeframe } from "@/lib/timeframes";
import { desc, eq } from "drizzle-orm";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

type InitialProfile = {
  handle: string;
  preferences: {
    defaultTimeframe: Timeframe;
    watchlist: string[];
    riskPerTradePct: number;
    maxDailyLossPct: number;
    cooldownAfterLosses: number;
    telegramEnabled: boolean;
    telegramChatId: string | null;
    autoRefreshSeconds: number;
  } | null;
} | null;

async function getInitialSignals() {
  const latest = await db
    .select({ batchId: signalSnapshots.batchId })
    .from(signalSnapshots)
    .orderBy(desc(signalSnapshots.createdAt))
    .limit(1);

  if (!latest.length) return [];

  const rows = await db
    .select()
    .from(signalSnapshots)
    .where(eq(signalSnapshots.batchId, latest[0].batchId))
    .orderBy(desc(signalSnapshots.probability));

  return rows.map((row) => ({
    coinId: row.coinId,
    symbol: row.symbol,
    name: row.name,
    timeframe: row.timeframe as Timeframe,
    action: row.action as "BUY" | "SELL" | "WAIT",
    score: row.score,
    probability: row.probability,
    entryPrice: row.entryPrice,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    riskReward: row.riskReward,
    note: row.note,
    factors: row.factors,
  }));
}

async function getInitialProfile(): Promise<InitialProfile> {
  const cookieStore = await cookies();
  const handle = cookieStore.get("mvp_user_handle")?.value;
  if (!handle) return null;

  const prefs = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) });
  return {
    handle,
    preferences: prefs
      ? {
          defaultTimeframe: prefs.defaultTimeframe as Timeframe,
          watchlist: prefs.watchlist,
          riskPerTradePct: prefs.riskPerTradePct,
          maxDailyLossPct: prefs.maxDailyLossPct,
          cooldownAfterLosses: prefs.cooldownAfterLosses,
          telegramEnabled: prefs.telegramEnabled,
          telegramChatId: prefs.telegramChatId,
          autoRefreshSeconds: prefs.autoRefreshSeconds,
        }
      : null,
  };
}

export default async function HomePage() {
  const [initialSignals, initialProfile] = await Promise.all([getInitialSignals(), getInitialProfile()]);

  return <SignalDashboard initialSignals={initialSignals} initialProfile={initialProfile} />;
}
