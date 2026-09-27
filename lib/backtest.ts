import { clamp, ema, normalize, rsi, sma } from "@/lib/indicators";
import type { Timeframe } from "@/lib/timeframes";

type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type Trade = {
  side: "LONG" | "SHORT";
  entryIndex: number;
  exitIndex: number;
  entry: number;
  stop: number;
  take: number;
  exit: number;
  resultR: number;
  outcome: "WIN" | "LOSS" | "TIME_EXIT";
  regime: "TRENDING" | "RANGING" | "HIGH_VOL_EVENT";
  predictedProbability: number;
};

export type BacktestResult = {
  pair: string;
  timeframe: Timeframe;
  lookback: number;
  trades: number;
  wins: number;
  losses: number;
  timedExits: number;
  winRate: number;
  netR: number;
  avgR: number;
  maxDrawdownR: number;
  expectancyR: number;
  feesR: number;
  slippageR: number;
  walkForward: {
    windows: number;
    avgWinRate: number;
    avgNetR: number;
  };
  monteCarlo: {
    meanR: number;
    p10R: number;
    p90R: number;
  };
  recentTrades: Trade[];
};

const intervalMap: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "6h": "6h",
  "1d": "1d",
  "1w": "1w",
};

function to2(n: number) {
  return Number(n.toFixed(2));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function normalizePair(coin: string) {
  const s = coin.toUpperCase().replace(/[^A-Z]/g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

async function fetchCandles(pair: string, timeframe: Timeframe, lookback: number) {
  const limit = Math.min(Math.max(lookback + 120, 220), 1000);
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${intervalMap[timeframe]}&limit=${limit}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Failed to fetch candles (${res.status})`);

  const raw = (await res.json()) as Array<
    [number, string, string, string, string, string, number, string, number, string, string, string]
  >;

  return raw.map((k) => ({
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  })) as Candle[];
}

function sample<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function classifyRegime(emaGapPct: number, movePct: number, volSpike: number) {
  if (volSpike > 1.9 || Math.abs(movePct) > 2.8) return "HIGH_VOL_EVENT" as const;
  if (Math.abs(emaGapPct) > 0.8) return "TRENDING" as const;
  return "RANGING" as const;
}

export async function runBacktest(coin: string, timeframe: Timeframe, lookback: number): Promise<BacktestResult> {
  const pair = normalizePair(coin || "BTC");
  const candles = await fetchCandles(pair, timeframe, lookback);
  const closes = candles.map((c) => c.c);
  const vols = candles.map((c) => c.v);

  const trades: Trade[] = [];
  let i = Math.max(60, candles.length - lookback);

  const takerFeePct = 0.04; // approx 0.04%
  const slippagePct = 0.03; // approx 0.03%
  let feesR = 0;
  let slippageR = 0;

  while (i < candles.length - 15) {
    const closeSlice = closes.slice(0, i + 1);
    const emaFast = ema(closeSlice, 12) ?? closes[i];
    const emaSlow = ema(closeSlice, 26) ?? closes[i];
    const prevFast = ema(closes.slice(0, i), 12) ?? closes[i - 1];
    const prevSlow = ema(closes.slice(0, i), 26) ?? closes[i - 1];
    const r = rsi(closeSlice, 14) ?? 50;

    const side: "LONG" | "SHORT" | null = prevFast <= prevSlow && emaFast > emaSlow && r < 75
      ? "LONG"
      : prevFast >= prevSlow && emaFast < emaSlow && r > 25
        ? "SHORT"
        : null;

    if (!side) {
      i++;
      continue;
    }

    const entryRaw = candles[i].c;
    const entry = side === "LONG" ? entryRaw * (1 + slippagePct / 100) : entryRaw * (1 - slippagePct / 100);

    const localRange = Math.max(candles[i].h - candles[i].l, entry * 0.0025);
    const stop = side === "LONG" ? entry - localRange : entry + localRange;
    const take = side === "LONG" ? entry + localRange * 1.8 : entry - localRange * 1.8;

    let exit = candles[i + 1].c;
    let outcome: Trade["outcome"] = "TIME_EXIT";
    let exitIndex = i + 1;

    for (let j = i + 1; j < Math.min(i + 15, candles.length); j++) {
      const c = candles[j];
      if (side === "LONG") {
        if (c.l <= stop) {
          exit = stop;
          outcome = "LOSS";
          exitIndex = j;
          break;
        }
        if (c.h >= take) {
          exit = take;
          outcome = "WIN";
          exitIndex = j;
          break;
        }
      } else {
        if (c.h >= stop) {
          exit = stop;
          outcome = "LOSS";
          exitIndex = j;
          break;
        }
        if (c.l <= take) {
          exit = take;
          outcome = "WIN";
          exitIndex = j;
          break;
        }
      }

      exit = c.c;
      exitIndex = j;
    }

    exit = side === "LONG" ? exit * (1 - slippagePct / 100) : exit * (1 + slippagePct / 100);

    const risk = Math.abs(entry - stop) || 0.0000001;
    const pnl = side === "LONG" ? exit - entry : entry - exit;
    let resultR = pnl / risk;

    const feeCost = ((entry + exit) * (takerFeePct / 100)) / risk;
    const slipCost = ((entry + exit) * (slippagePct / 100)) / risk;
    resultR -= feeCost + slipCost;
    feesR += feeCost;
    slippageR += slipCost;

    const emaTrend = ((emaFast - emaSlow) / Math.max(emaSlow, 0.000001)) * 100;
    const movePct = ((closes[i] - closes[Math.max(0, i - 8)]) / closes[Math.max(0, i - 8)]) * 100;
    const volSpike = (vols[i] || 1) / Math.max(sma(vols.slice(0, i + 1), 20) || 1, 0.000001);
    const regime = classifyRegime(emaTrend, movePct, volSpike);

    const predictedProbability = to2(
      clamp(
        normalize(resultR, -1.2, 1.8) * 0.35 + normalize(emaTrend, -1.5, 1.5) * 0.3 + normalize(r, 20, 80) * 0.15 + normalize(volSpike, 0.8, 2.3) * 0.2,
        8,
        96,
      ),
    );

    trades.push({
      side,
      entryIndex: i,
      exitIndex,
      entry: to2(entry),
      stop: to2(stop),
      take: to2(take),
      exit: to2(exit),
      resultR: to2(resultR),
      outcome,
      regime,
      predictedProbability,
    });

    i = exitIndex + 1;
  }

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: number[] = [];
  trades.forEach((t) => {
    equity += t.resultR;
    equityCurve.push(equity);
    if (equity > peak) peak = equity;
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  });

  const wins = trades.filter((t) => t.outcome === "WIN").length;
  const losses = trades.filter((t) => t.outcome === "LOSS").length;
  const timedExits = trades.filter((t) => t.outcome === "TIME_EXIT").length;
  const netR = trades.reduce((s, t) => s + t.resultR, 0);
  const avgR = trades.length ? netR / trades.length : 0;
  const winRate = trades.length ? (wins / trades.length) * 100 : 0;

  // Walk-forward (3 windows)
  const windows = 3;
  const chunk = Math.max(Math.floor(trades.length / windows), 1);
  const wfStats: Array<{ wr: number; net: number }> = [];
  for (let w = 0; w < windows; w++) {
    const slice = trades.slice(w * chunk, (w + 1) * chunk);
    if (!slice.length) continue;
    const wr = (slice.filter((t) => t.outcome === "WIN").length / slice.length) * 100;
    const n = slice.reduce((s, t) => s + t.resultR, 0);
    wfStats.push({ wr, net: n });
  }

  // Monte Carlo shuffle
  const simulations = 200;
  const mc: number[] = [];
  for (let s = 0; s < simulations; s++) {
    let sum = 0;
    for (let j = 0; j < trades.length; j++) {
      sum += sample(trades)?.resultR ?? 0;
    }
    mc.push(sum);
  }

  return {
    pair,
    timeframe,
    lookback,
    trades: trades.length,
    wins,
    losses,
    timedExits,
    winRate: to2(winRate),
    netR: to2(netR),
    avgR: to2(avgR),
    maxDrawdownR: to2(maxDrawdown),
    expectancyR: to2(avgR),
    feesR: to2(feesR),
    slippageR: to2(slippageR),
    walkForward: {
      windows: wfStats.length,
      avgWinRate: to2(wfStats.length ? avg(wfStats.map((w) => w.wr)) : 0),
      avgNetR: to2(wfStats.length ? avg(wfStats.map((w) => w.net)) : 0),
    },
    monteCarlo: {
      meanR: to2(mc.length ? avg(mc) : 0),
      p10R: to2(percentile(mc, 10)),
      p90R: to2(percentile(mc, 90)),
    },
    recentTrades: trades.slice(-20),
  };
}
