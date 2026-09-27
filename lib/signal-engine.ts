import { fetchMarketCoins, type MarketCoin } from "@/lib/market-data";
import { clamp, ema, macd, normalize, rsi, sma, stdDev } from "@/lib/indicators";
import type { Timeframe } from "@/lib/timeframes";

export type ComputedSignal = {
  coinId: string;
  symbol: string;
  name: string;
  timeframe: Timeframe;
  action: "BUY" | "SELL" | "WAIT";
  score: number;
  probability: number;
  entryPrice: number;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  note: string;
  factors: Record<string, number>;
  regime: "TRENDING" | "RANGING" | "HIGH_VOL_EVENT";
  abstainReason: string | null;
  eventRisk: number;
  alignmentScore: number;
  htfConfirmation: number;
  buyIndex: number;
  riskIndex: number;
  scalpSetup: "READY" | "BUILDING" | "LATE" | "AVOID";
  setupState: "BUILDING" | "READY" | "TRIGGERED" | "EXPIRED";
  setupExpiresAt: string;
  distanceToEntryPct: number;
  signalArrow: "UP_RIGHT" | "DOWN_RIGHT" | "FLAT";
  notificationReady: boolean;
  nextMove: {
    tpBeforeSlProb: number;
    expectedMovePct: number;
    confidenceLow: number;
    confidenceHigh: number;
  };
};

const timeframeRisk: Record<Timeframe, number> = {
  "5m": 0.009,
  "15m": 0.013,
  "30m": 0.016,
  "1h": 0.02,
  "4h": 0.028,
  "6h": 0.033,
  "1d": 0.045,
  "1w": 0.08,
};

function toFixed2(n: number) {
  return Number(n.toFixed(2));
}

function avg(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function slope(values: number[]) {
  if (values.length < 2) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

function deriveRegime(volatility: number, trendPct: number, oneHourChange: number) {
  if (volatility > 11 || Math.abs(oneHourChange) > 3.4) return "HIGH_VOL_EVENT" as const;
  if (Math.abs(trendPct) > 1.2) return "TRENDING" as const;
  return "RANGING" as const;
}

function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const meanA = avg(ax);
  const meanB = avg(bx);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = ax[i] - meanA;
    const y = bx[i] - meanB;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

export async function fetchTopCoins(limit = 200): Promise<MarketCoin[]> {
  const { coins } = await fetchMarketCoins(limit);
  return coins;
}

function buildSignal(coin: MarketCoin, timeframe: Timeframe): ComputedSignal {
  const prices = coin.sparkline_in_7d?.price ?? [];
  const shortWindow = prices.slice(-24);
  const mediumWindow = prices.slice(-48);
  const longWindow = prices.slice(-72);

  const maShort = avg(shortWindow);
  const maLong = avg(longWindow);
  const trendPct = maLong > 0 ? ((maShort - maLong) / maLong) * 100 : 0;
  const slopePct = slope(shortWindow);

  const change1h = coin.price_change_percentage_1h_in_currency ?? 0;
  const change24h = coin.price_change_percentage_24h ?? 0;
  const change7d = coin.price_change_percentage_7d_in_currency ?? 0;

  const ema20 = ema(prices, 20) ?? coin.current_price;
  const sma50 = sma(prices, 50) ?? coin.current_price;
  const rsi14 = rsi(prices, 14) ?? 50;
  const macdNow = macd(prices) ?? { line: 0, signal: 0, hist: 0 };

  const volatility = coin.low_24h > 0 ? ((coin.high_24h - coin.low_24h) / coin.low_24h) * 100 : 0;
  const volumePressure = coin.market_cap > 0 ? (coin.total_volume / coin.market_cap) * 100 : 0;

  const returns = mediumWindow.slice(1).map((p, i) => (p - mediumWindow[i]) / Math.max(mediumWindow[i], 0.000001));
  const volStdev = stdDev(returns) * 100;
  const atrProxyPct = normalize(volatility * 0.68 + volStdev * 0.32, 0.6, 8.5);

  const momentumScore = normalize(change1h * 0.5 + change24h * 0.35 + slopePct * 0.45 + macdNow.hist * 24, -8, 8);
  const trendScore = normalize(trendPct * 0.8 + change7d * 0.2 + ((ema20 - sma50) / Math.max(sma50, 0.000001)) * 100, -15, 15);
  const volumeScore = normalize(volumePressure, 0.8, 16);
  const volatilityScore = normalize(volatility, 1.5, 14);
  const rsiScore = normalize(Math.abs(rsi14 - 50), 2, 28);
  const macdScore = normalize(macdNow.hist * 100, -1.2, 1.2);

  const pullback = normalize(
    ((coin.current_price - coin.low_24h) / Math.max(coin.high_24h - coin.low_24h, 0.000001)) * 100,
    0,
    100,
  );
  const patternScore = clamp((100 - Math.abs(50 - pullback) * 1.6 + volatilityScore * 0.25) / 1.25, 0, 100);

  const rankBonus = normalize(220 - (coin.market_cap_rank || 200), 20, 220);

  const signs = [change1h, change24h, change7d].map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
  const alignmentRaw = signs[0] === signs[1] && signs[1] === signs[2] ? 100 : signs[1] === signs[2] ? 68 : 38;
  const alignmentScore = toFixed2(alignmentRaw);

  const regime = deriveRegime(volatility, trendPct, change1h);
  const eventRisk = toFixed2(clamp(normalize(Math.abs(change1h), 0.8, 5.2) * 0.55 + normalize(volatility, 4, 16) * 0.45, 0, 100));

  const baseScore =
    momentumScore * 0.21 +
    trendScore * 0.2 +
    volumeScore * 0.14 +
    volatilityScore * 0.1 +
    patternScore * 0.08 +
    rankBonus * 0.05 +
    rsiScore * 0.08 +
    macdScore * 0.08 +
    atrProxyPct * 0.06;

  const contrarianSellBoost = clamp(normalize(-(change1h + slopePct), -8, 8), 0, 100);

  let action: "BUY" | "SELL" | "WAIT" = "WAIT";
  let score = toFixed2(baseScore);
  let abstainReason: string | null = null;

  if (eventRisk >= 78) {
    abstainReason = "Event-risk volatility spike; wait for stabilization.";
  } else if (volumeScore < 24) {
    abstainReason = "Insufficient participation/volume quality.";
  } else if (regime === "RANGING" && alignmentScore < 58) {
    abstainReason = "No clean multi-timeframe alignment in ranging regime.";
  }

  if (!abstainReason) {
    if (score >= 66 && momentumScore >= 54 && trendScore >= 52 && alignmentScore >= 60) {
      action = "BUY";
    } else if (score <= 43 && contrarianSellBoost > 60 && volatilityScore >= 38 && alignmentScore <= 55) {
      action = "SELL";
      score = toFixed2(clamp(100 - score * 0.7 + contrarianSellBoost * 0.3, 0, 100));
    } else {
      abstainReason = "Confluence threshold not met.";
    }
  }

  const probability = toFixed2(
    clamp(
      action === "WAIT"
        ? score * 0.7
        : score * 0.82 + (action === "BUY" ? trendScore * 0.09 : contrarianSellBoost * 0.09),
      8,
      97,
    ),
  );

  const risk = timeframeRisk[timeframe];
  const entryPrice = coin.current_price;
  const stopLoss = action === "SELL" ? entryPrice * (1 + risk) : entryPrice * (1 - risk);
  const takeProfit = action === "SELL" ? entryPrice * (1 - risk * 1.8) : entryPrice * (1 + risk * 1.8);
  const riskReward = 1.8;

  const zonePct = risk * 0.45;
  const entryLow = action === "SELL" ? entryPrice * (1 + zonePct) : entryPrice * (1 - zonePct);
  const entryHigh = action === "SELL" ? entryPrice * (1 - zonePct) : entryPrice * (1 + zonePct);

  const distanceToEntryPct = toFixed2(
    action === "SELL"
      ? ((entryPrice - Math.min(entryLow, entryHigh)) / Math.max(entryPrice, 0.000001)) * 100
      : ((Math.max(entryLow, entryHigh) - entryPrice) / Math.max(entryPrice, 0.000001)) * 100,
  );

  const tfMs: Record<Timeframe, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  };
  const setupExpiresAt = new Date(Date.now() + tfMs[timeframe] * 3).toISOString();

  const tpBeforeSlProb = toFixed2(clamp(probability - eventRisk * 0.12 + (alignmentScore - 50) * 0.1, 5, 95));
  const expectedMovePct = toFixed2(clamp((atrProxyPct / 100) * (action === "WAIT" ? 0.6 : 1.2) * 3.2, 0.2, 12));
  const confidenceLow = toFixed2(clamp(tpBeforeSlProb - 8, 1, 95));
  const confidenceHigh = toFixed2(clamp(tpBeforeSlProb + 8, 1, 99));

  const htfConfirmation = toFixed2(
    clamp(
      trendScore * 0.34 + alignmentScore * 0.33 + momentumScore * 0.2 + (regime === "TRENDING" ? 14 : regime === "RANGING" ? 6 : 0),
      0,
      100,
    ),
  );

  const buyIndex = toFixed2(
    clamp(
      action === "BUY"
        ? probability * 0.55 + htfConfirmation * 0.35 + tpBeforeSlProb * 0.1
        : probability * 0.3,
      0,
      100,
    ),
  );

  const riskIndex = toFixed2(
    clamp(eventRisk * 0.52 + (100 - alignmentScore) * 0.24 + (regime === "HIGH_VOL_EVENT" ? 20 : 0), 0, 100),
  );

  const scalpSetup: "READY" | "BUILDING" | "LATE" | "AVOID" =
    action === "BUY" && buyIndex >= 72 && htfConfirmation >= 66 && riskIndex <= 48
      ? "READY"
      : action === "BUY" && buyIndex >= 58 && riskIndex <= 62
        ? "BUILDING"
        : action === "BUY"
          ? "LATE"
          : "AVOID";

  const setupState: "BUILDING" | "READY" | "TRIGGERED" | "EXPIRED" =
    action !== "BUY"
      ? "EXPIRED"
      : scalpSetup === "BUILDING"
        ? "BUILDING"
        : scalpSetup === "READY"
          ? "READY"
          : riskIndex > 66 || eventRisk > 72
            ? "EXPIRED"
            : "TRIGGERED";

  const signalArrow: "UP_RIGHT" | "DOWN_RIGHT" | "FLAT" =
    action === "BUY" ? "UP_RIGHT" : action === "SELL" ? "DOWN_RIGHT" : "FLAT";

  const notificationReady = action === "BUY" && setupState === "READY";

  const note =
    action === "BUY"
      ? `Bullish setup with ${regime.toLowerCase()} context. Prefer pullback entries near EMA20/SMA50 support and protect risk with ATR-based stops.`
      : action === "SELL"
        ? `Bearish setup with downside pressure. Prefer failed retraces into resistance and enforce tight risk in volatile phases.`
        : `No-trade mode active: ${abstainReason ?? "confluence weak"}`;

  return {
    coinId: coin.id,
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    timeframe,
    action,
    score: toFixed2(score),
    probability: toFixed2(probability),
    entryPrice: toFixed2(entryPrice),
    entryLow: toFixed2(Math.min(entryLow, entryHigh)),
    entryHigh: toFixed2(Math.max(entryLow, entryHigh)),
    stopLoss: toFixed2(stopLoss),
    takeProfit: toFixed2(takeProfit),
    riskReward,
    note,
    regime,
    abstainReason,
    eventRisk,
    alignmentScore,
    htfConfirmation,
    buyIndex,
    riskIndex,
    scalpSetup,
    setupState,
    setupExpiresAt,
    distanceToEntryPct,
    signalArrow,
    notificationReady,
    nextMove: {
      tpBeforeSlProb,
      expectedMovePct,
      confidenceLow,
      confidenceHigh,
    },
    factors: {
      momentum: toFixed2(momentumScore),
      trend: toFixed2(trendScore),
      volume: toFixed2(volumeScore),
      volatility: toFixed2(volatilityScore),
      pattern: toFixed2(patternScore),
      liquidityRank: toFixed2(rankBonus),
      sellPressure: toFixed2(contrarianSellBoost),
      rsi: toFixed2(rsi14),
      macdHist: toFixed2(macdNow.hist),
      ema20: toFixed2(ema20),
      sma50: toFixed2(sma50),
      atrProxy: toFixed2(atrProxyPct),
      alignment: alignmentScore,
      eventRisk,
      htfConfirmation,
      buyIndex,
      riskIndex,
    },
  };
}

export function computeSignals(coins: MarketCoin[], timeframe: Timeframe) {
  const computed = coins.map((coin) => ({ signal: buildSignal(coin, timeframe), spark: coin.sparkline_in_7d?.price ?? [] }));

  const sorted = computed.sort((a, b) => {
    const aStrength = a.signal.action === "WAIT" ? a.signal.score * 0.7 : a.signal.probability;
    const bStrength = b.signal.action === "WAIT" ? b.signal.score * 0.7 : b.signal.probability;
    return bStrength - aStrength;
  });

  // Correlation-aware selection: cap highly-correlated same-direction clusters.
  const selected: Array<typeof sorted[number]> = [];
  for (const row of sorted) {
    let correlatedCount = 0;
    for (const s of selected) {
      const corr = pearson(row.spark.slice(-64), s.spark.slice(-64));
      if (corr > 0.92 && row.signal.action === s.signal.action && row.signal.action !== "WAIT") {
        correlatedCount += 1;
      }
    }

    if (correlatedCount >= 2) continue;
    selected.push(row);
    if (selected.length >= 10) break;
  }

  return selected.map((r) => r.signal);
}

export function computeSingleCoinSignal(coins: MarketCoin[], identifier: string, timeframe: Timeframe) {
  const normalized = identifier.trim().toLowerCase();
  const found = coins.find(
    (coin) => coin.id.toLowerCase() === normalized || coin.symbol.toLowerCase() === normalized,
  );

  if (!found) return null;
  return buildSignal(found, timeframe);
}
