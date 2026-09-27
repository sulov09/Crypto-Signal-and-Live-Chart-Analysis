import { clamp, ema, macd, normalize, rsi } from "@/lib/indicators";

export type ReplayCandle = {
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ReplayFrame = {
  index: number;
  openTime: string;
  close: number;
  action: "BUY" | "SELL" | "WAIT";
  probability: number;
  regime: "TRENDING" | "RANGING" | "HIGH_VOL_EVENT";
  reason: string;
  outcomeWin: 0 | 1 | null;
  runningWinRate: number;
  runningR: number;
};

export type ReplaySimulation = {
  frames: ReplayFrame[];
  summary: {
    totalFrames: number;
    actionableFrames: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
  };
};

function to2(n: number) {
  return Number(n.toFixed(2));
}

function regimeFromWindow(highs: number[], lows: number[], closes: number[]) {
  const last = closes[closes.length - 1] || 1;
  const rangePct = ((Math.max(...highs) - Math.min(...lows)) / Math.max(last, 0.000001)) * 100;
  const trendPct = ((closes[closes.length - 1] - closes[0]) / Math.max(closes[0], 0.000001)) * 100;
  if (rangePct > 5.2 || Math.abs(trendPct) > 2.7) return "HIGH_VOL_EVENT" as const;
  if (Math.abs(trendPct) > 0.9) return "TRENDING" as const;
  return "RANGING" as const;
}

export function simulateReplay(candles: ReplayCandle[]): ReplaySimulation {
  const frames: ReplayFrame[] = [];

  let wins = 0;
  let losses = 0;
  let netR = 0;
  let actionable = 0;

  for (let i = 60; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map((c) => c.close);
    const highs = slice.slice(-24).map((c) => c.high);
    const lows = slice.slice(-24).map((c) => c.low);
    const vols = slice.slice(-24).map((c) => c.volume);

    const emaFast = ema(closes, 21) ?? closes[closes.length - 1];
    const emaSlow = ema(closes, 55) ?? closes[closes.length - 1];
    const r = rsi(closes, 14) ?? 50;
    const m = macd(closes) ?? { line: 0, signal: 0, hist: 0 };
    const volRatio = (vols.slice(-6).reduce((s, v) => s + v, 0) / 6) / Math.max(vols.reduce((s, v) => s + v, 0) / vols.length, 0.000001);

    const regime = regimeFromWindow(highs, lows, closes.slice(-24));

    const trendScore = normalize(((emaFast - emaSlow) / Math.max(emaSlow, 0.000001)) * 100, -1.8, 1.8);
    const momentumScore = normalize(m.hist, -0.5, 0.5);
    const rsiScore = normalize(r, 20, 80);
    const volumeScore = normalize(volRatio, 0.7, 1.9);

    const upConfluence = trendScore * 0.38 + momentumScore * 0.24 + rsiScore * 0.22 + volumeScore * 0.16;
    const downConfluence =
      normalize(-((emaFast - emaSlow) / Math.max(emaSlow, 0.000001)) * 100, -1.8, 1.8) * 0.38 +
      normalize(-m.hist, -0.5, 0.5) * 0.24 +
      normalize(100 - r, 20, 80) * 0.22 +
      volumeScore * 0.16;

    let action: "BUY" | "SELL" | "WAIT" = "WAIT";
    let probability = 0;
    let reason = "Confluence insufficient";

    if (regime !== "HIGH_VOL_EVENT" && upConfluence >= 62 && r >= 45 && m.hist >= -0.02) {
      action = "BUY";
      probability = to2(clamp(upConfluence, 8, 96));
      reason = "EMA trend + RSI/MACD bullish confluence";
    } else if (regime !== "HIGH_VOL_EVENT" && downConfluence >= 62 && r <= 55 && m.hist <= 0.02) {
      action = "SELL";
      probability = to2(clamp(downConfluence, 8, 96));
      reason = "EMA trend + RSI/MACD bearish confluence";
    } else if (regime === "HIGH_VOL_EVENT") {
      reason = "Event volatility regime (abstain)";
      probability = to2(clamp(Math.max(upConfluence, downConfluence) * 0.7, 6, 80));
    } else {
      probability = to2(clamp(Math.max(upConfluence, downConfluence) * 0.7, 6, 85));
    }

    let outcomeWin: 0 | 1 | null = null;

    if (action !== "WAIT" && i < candles.length - 1) {
      actionable += 1;
      const next = candles[i + 1].close;
      if ((action === "BUY" && next > candles[i].close) || (action === "SELL" && next < candles[i].close)) {
        outcomeWin = 1;
        wins += 1;
        netR += 1;
      } else {
        outcomeWin = 0;
        losses += 1;
        netR -= 1;
      }
    }

    const runningWinRate = actionable ? (wins / actionable) * 100 : 0;

    frames.push({
      index: i,
      openTime: candles[i].openTime.toISOString(),
      close: to2(candles[i].close),
      action,
      probability,
      regime,
      reason,
      outcomeWin,
      runningWinRate: to2(runningWinRate),
      runningR: to2(netR),
    });
  }

  return {
    frames,
    summary: {
      totalFrames: frames.length,
      actionableFrames: actionable,
      wins,
      losses,
      winRate: to2(actionable ? (wins / actionable) * 100 : 0),
      netR: to2(netR),
    },
  };
}
