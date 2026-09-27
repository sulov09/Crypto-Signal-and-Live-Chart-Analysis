import { db } from "@/db";
import { signalEvaluations, signalSnapshots } from "@/db/schema";
import { getCurrentHandle } from "@/lib/session";
import { and, desc, eq, gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

function to2(n: number) {
  return Number(n.toFixed(2));
}

export async function GET() {
  const handle = await getCurrentHandle();
  const since = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);

  const evals = await db
    .select()
    .from(signalEvaluations)
    .where(handle ? and(eq(signalEvaluations.userHandle, handle), gte(signalEvaluations.createdAt, since)) : gte(signalEvaluations.createdAt, since))
    .orderBy(desc(signalEvaluations.createdAt))
    .limit(400);

  const snapshots = await db
    .select()
    .from(signalSnapshots)
    .where(gte(signalSnapshots.createdAt, since))
    .orderBy(desc(signalSnapshots.createdAt))
    .limit(400);

  const n = evals.length;
  const brier = n
    ? evals.reduce((s, e) => s + (e.predictedProbability / 100 - e.outcomeWin) ** 2, 0) / n
    : 0;

  const highConf = evals.filter((e) => e.predictedProbability >= 70);
  const precision70 = highConf.length ? (highConf.filter((e) => e.outcomeWin === 1).length / highConf.length) * 100 : 0;

  const avgPred = n ? evals.reduce((s, e) => s + e.predictedProbability, 0) / n : 0;
  const realized = n ? (evals.filter((e) => e.outcomeWin === 1).length / n) * 100 : 0;
  const calibrationGap = avgPred - realized;

  const actionableSnapshots = snapshots.filter((s) => s.action !== "WAIT").length;
  const abstainRate = snapshots.length ? ((snapshots.length - actionableSnapshots) / snapshots.length) * 100 : 0;

  const regimeCounts = evals.reduce<Record<string, { count: number; winRate: number }>>((acc, row) => {
    const key = row.regime;
    if (!acc[key]) acc[key] = { count: 0, winRate: 0 };
    acc[key].count += 1;
    acc[key].winRate += row.outcomeWin;
    return acc;
  }, {});

  Object.keys(regimeCounts).forEach((k) => {
    regimeCounts[k].winRate = to2((regimeCounts[k].winRate / Math.max(regimeCounts[k].count, 1)) * 100);
  });

  const pnlR = evals.reduce((s, e) => s + e.pnlR, 0);

  return Response.json({
    ok: true,
    metrics: {
      sampleSize: n,
      brierScore: to2(brier),
      precisionAt70: to2(precision70),
      averagePredictedProb: to2(avgPred),
      realizedWinRate: to2(realized),
      calibrationGap: to2(calibrationGap),
      abstainRate: to2(abstainRate),
      coverageRate: to2(100 - abstainRate),
      pnlR: to2(pnlR),
      regimeBreakdown: regimeCounts,
    },
  });
}
