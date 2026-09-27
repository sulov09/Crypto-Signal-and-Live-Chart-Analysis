import { clamp, ema, macd, normalize, rsi, sma } from "@/lib/indicators";
import { fetchBestKlines } from "@/lib/ohlcv-providers";
import type { Timeframe } from "@/lib/timeframes";

type Kline = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type EventType =
  | "SFP"
  | "BOS"
  | "MSS"
  | "SWING_HIGH"
  | "SWING_LOW"
  | "LIQUIDITY"
  | "IMBALANCE"
  | "ORDER_BLOCK";

type ChartEvent = {
  type: EventType;
  index: number;
  price: number;
  side: "bullish" | "bearish" | "neutral";
  label: string;
};

export type LiveAnalysisResult = {
  pair: string;
  timeframe: Timeframe;
  candles: Kline[];
  events: ChartEvent[];
  liquidityLevels: number[];
  direction: "UP" | "DOWN" | "RANGE";
  regime: "TRENDING" | "RANGING" | "HIGH_VOL_EVENT";
  action: "BUY" | "SELL" | "WAIT";
  probability: number;
  confidenceScore: number;
  eventRisk: number;
  abstainReason: string | null;
  mtfAlignment: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  note: string;
  projectedPath: Array<{ index: number; price: number }>;
  nextMove: {
    tpBeforeSlProb: number;
    expectedMovePct: number;
    confidenceLow: number;
    confidenceHigh: number;
  };
  orderFlow: {
    bookImbalance: number;
    fundingRate: number | null;
    openInterest: number | null;
  };
  reliability: {
    wsRecommended: boolean;
    reconnectBackfillRecommended: boolean;
  };
};



function to2(n: number) {
  return Number(n.toFixed(2));
}

function avg(list: number[]) {
  if (!list.length) return 0;
  return list.reduce((s, v) => s + v, 0) / list.length;
}

function detectSwings(candles: Kline[]) {
  const swingHighs: Array<{ index: number; price: number }> = [];
  const swingLows: Array<{ index: number; price: number }> = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const h = candles[i].high;
    const l = candles[i].low;

    if (h > candles[i - 1].high && h > candles[i - 2].high && h > candles[i + 1].high && h > candles[i + 2].high) {
      swingHighs.push({ index: i, price: h });
    }

    if (l < candles[i - 1].low && l < candles[i - 2].low && l < candles[i + 1].low && l < candles[i + 2].low) {
      swingLows.push({ index: i, price: l });
    }
  }

  return { swingHighs, swingLows };
}

function directionFromStructure(candles: Kline[]) {
  const closes = candles.slice(-40).map((c) => c.close);
  const first = closes[0] ?? 0;
  const last = closes[closes.length - 1] ?? 0;
  const move = first ? ((last - first) / first) * 100 : 0;

  if (move > 1.2) return "UP" as const;
  if (move < -1.2) return "DOWN" as const;
  return "RANGE" as const;
}

function normalizeCoinToPair(input: string) {
  const symbol = input.toUpperCase().replace(/[^A-Z]/g, "");
  const stripped = symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
  return `${stripped}USDT`;
}

async function fetchKlines(pair: string, tf: Timeframe, limit = 220) {
  const { candles } = await fetchBestKlines(pair, tf, limit);
  return candles.map((k) => ({
    openTime: k.openTime,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  })) as Kline[];
}

async function safeFetch(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

async function fetchOrderFlow(pair: string) {
  const [depthRes, fundingRes, oiRes] = await Promise.all([
    safeFetch(`https://api.binance.com/api/v3/depth?symbol=${pair}&limit=100`),
    safeFetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`),
    safeFetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${pair}`),
  ]);

  let bookImbalance = 0;
  if (depthRes) {
    const d = (await depthRes.json()) as { bids: [string, string][]; asks: [string, string][] };
    const bidVol = d.bids.reduce((s, b) => s + Number(b[1]), 0);
    const askVol = d.asks.reduce((s, a) => s + Number(a[1]), 0);
    const denom = bidVol + askVol || 1;
    bookImbalance = ((bidVol - askVol) / denom) * 100;
  }

  let fundingRate: number | null = null;
  if (fundingRes) {
    const f = (await fundingRes.json()) as { lastFundingRate?: string };
    if (f.lastFundingRate) fundingRate = Number(f.lastFundingRate) * 100;
  }

  let openInterest: number | null = null;
  if (oiRes) {
    const oi = (await oiRes.json()) as { openInterest?: string };
    if (oi.openInterest) openInterest = Number(oi.openInterest);
  }

  return { bookImbalance: to2(bookImbalance), fundingRate, openInterest };
}

async function mtfAlignment(pair: string) {
  try {
    const [k15, k1h, k4h] = await Promise.all([
      fetchKlines(pair, "15m", 90),
      fetchKlines(pair, "1h", 90),
      fetchKlines(pair, "4h", 90),
    ]);
    const dir = (candles: Kline[]) => {
      const a = candles[candles.length - 1].close;
      const b = candles[Math.max(0, candles.length - 15)].close;
      return a > b ? 1 : a < b ? -1 : 0;
    };
    const d15 = dir(k15);
    const d1 = dir(k1h);
    const d4 = dir(k4h);
    if (d15 === d1 && d1 === d4) return 100;
    if (d1 === d4) return 68;
    return 42;
  } catch {
    return 55;
  }
}

export async function analyzeLiveCoin(
  coin: string,
  timeframe: Timeframe,
  cachedCandles?: Array<{ openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number }>,
): Promise<LiveAnalysisResult> {
  const pair = normalizeCoinToPair(coin);
  let candles = cachedCandles?.length
    ? cachedCandles.map((c) => ({
        openTime: c.openTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }))
    : [];

  if (candles.length < 60) {
    candles = await fetchKlines(pair, timeframe, 220);
  }

  if (candles.length < 50) {
    throw new Error("Not enough candle data for analysis");
  }

  const { swingHighs, swingLows } = detectSwings(candles);
  const events: ChartEvent[] = [];

  swingHighs.slice(-6).forEach((s) => {
    events.push({ type: "SWING_HIGH", index: s.index, price: to2(s.price), side: "bearish", label: "Swing High" });
  });
  swingLows.slice(-6).forEach((s) => {
    events.push({ type: "SWING_LOW", index: s.index, price: to2(s.price), side: "bullish", label: "Swing Low" });
  });

  const recent = candles.slice(-80);
  const avgRange = avg(recent.map((c) => c.high - c.low));

  for (let i = candles.length - 70; i < candles.length; i++) {
    if (i <= 1) continue;
    const c = candles[i];
    const prev = candles[i - 1];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;

    if (range > avgRange * 1.8 && body / Math.max(range, 0.000001) > 0.65) {
      events.push({
        type: "IMBALANCE",
        index: i,
        price: to2(c.close),
        side: c.close > c.open ? "bullish" : "bearish",
        label: "Imbalance (FVG proxy)",
      });
    }

    if (c.high > prev.high && c.close < prev.high) {
      events.push({ type: "SFP", index: i, price: to2(c.high), side: "bearish", label: "SFP High" });
    }
    if (c.low < prev.low && c.close > prev.low) {
      events.push({ type: "SFP", index: i, price: to2(c.low), side: "bullish", label: "SFP Low" });
    }
  }

  const lastClose = candles[candles.length - 1].close;
  const lastHighs = swingHighs.filter((s) => s.index < candles.length - 1).slice(-3);
  const lastLows = swingLows.filter((s) => s.index < candles.length - 1).slice(-3);
  const nearestHigh = lastHighs[lastHighs.length - 1]?.price;
  const nearestLow = lastLows[lastLows.length - 1]?.price;

  if (nearestHigh && lastClose > nearestHigh) {
    events.push({ type: "BOS", index: candles.length - 1, price: to2(lastClose), side: "bullish", label: "BOS Up" });
  }
  if (nearestLow && lastClose < nearestLow) {
    events.push({ type: "BOS", index: candles.length - 1, price: to2(lastClose), side: "bearish", label: "BOS Down" });
  }

  if (nearestHigh && nearestLow && lastClose < nearestHigh && lastClose > nearestLow) {
    events.push({ type: "MSS", index: candles.length - 1, price: to2(lastClose), side: "neutral", label: "MSS Zone" });
  }

  const impulseIndex = candles.length - 8;
  const impulse = candles[impulseIndex];
  for (let i = impulseIndex - 1; i >= Math.max(4, impulseIndex - 12); i--) {
    const c = candles[i];
    if ((impulse.close > impulse.open && c.close < c.open) || (impulse.close < impulse.open && c.close > c.open)) {
      events.push({
        type: "ORDER_BLOCK",
        index: i,
        price: to2((c.open + c.close) / 2),
        side: impulse.close > impulse.open ? "bullish" : "bearish",
        label: "Order Block (proxy)",
      });
      break;
    }
  }

  const liquidityLevels = [...swingHighs.slice(-3).map((s) => to2(s.price)), ...swingLows.slice(-3).map((s) => to2(s.price))];

  liquidityLevels.forEach((lv) => {
    events.push({ type: "LIQUIDITY", index: candles.length - 1, price: lv, side: "neutral", label: "Liquidity" });
  });

  const direction = directionFromStructure(candles);
  const bullishEvents = events.filter((e) => e.side === "bullish").length;
  const bearishEvents = events.filter((e) => e.side === "bearish").length;
  const directionalBias = bullishEvents - bearishEvents;

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const vols = candles.map((c) => c.volume);

  const rsi14 = rsi(closes, 14) ?? 50;
  const ema21 = ema(closes, 21) ?? lastClose;
  const sma55 = sma(closes, 55) ?? lastClose;
  const m = macd(closes) ?? { line: 0, signal: 0, hist: 0 };

  const rangePct = ((Math.max(...highs.slice(-24)) - Math.min(...lows.slice(-24))) / Math.max(lastClose, 0.000001)) * 100;
  const volumeZ = normalize((avg(vols.slice(-8)) / Math.max(avg(vols.slice(-40)), 0.000001)) * 100, 70, 220);

  const orderFlow = await fetchOrderFlow(pair);
  const mtf = await mtfAlignment(pair);

  const eventRisk = to2(
    clamp(
      normalize(Math.abs((lastClose - closes[closes.length - 12]) / closes[closes.length - 12]) * 100, 0.9, 4.8) * 0.45 +
        normalize(rangePct, 1.8, 9.5) * 0.35 +
        normalize(Math.abs(orderFlow.bookImbalance), 8, 48) * 0.2,
      0,
      100,
    ),
  );

  const regime = eventRisk > 76 ? "HIGH_VOL_EVENT" : Math.abs((ema21 - sma55) / sma55) * 100 > 0.9 ? "TRENDING" : "RANGING";

  const structureScore = clamp(50 + directionalBias * 6 + (direction === "UP" ? 6 : direction === "DOWN" ? -6 : 0), 1, 99);
  const momentumScore = clamp(50 + m.hist * 80 + ((lastClose - closes[closes.length - 8]) / closes[closes.length - 8]) * 300, 1, 99);
  const indicatorScore = clamp(
    normalize(rsi14, 35, 70) * 0.22 +
      normalize(m.hist, -0.8, 0.8) * 0.2 +
      normalize(((ema21 - sma55) / Math.max(sma55, 0.000001)) * 100, -2.2, 2.2) * 0.2 +
      volumeZ * 0.13 +
      normalize(orderFlow.bookImbalance, -45, 45) * 0.1 +
      mtf * 0.15,
    1,
    99,
  );

  let action: "BUY" | "SELL" | "WAIT" = "WAIT";
  let abstainReason: string | null = null;

  if (eventRisk >= 82) abstainReason = "Event-risk spike: avoid fresh entries until volatility normalizes.";
  if (regime === "RANGING" && mtf < 60) abstainReason = abstainReason ?? "Ranging + weak MTF alignment.";

  if (!abstainReason) {
    if ((direction === "UP" && directionalBias >= -1 && m.hist >= -0.02 && mtf >= 60) || directionalBias >= 5) {
      action = "BUY";
    } else if ((direction === "DOWN" && directionalBias <= 1 && m.hist <= 0.02 && mtf >= 60) || directionalBias <= -5) {
      action = "SELL";
    } else {
      abstainReason = "No clean trigger confluence.";
    }
  }

  const confidenceScore = clamp(structureScore * 0.35 + momentumScore * 0.3 + indicatorScore * 0.35, 5, 97);
  const probability = to2(clamp(action === "WAIT" ? confidenceScore * 0.74 : confidenceScore - eventRisk * 0.08, 8, 97));

  const entry = lastClose;
  const riskUnit = Math.max(avgRange * 0.8, entry * 0.002);
  const stopLoss = action === "SELL" ? entry + riskUnit : entry - riskUnit;
  const takeProfit = action === "SELL" ? entry - riskUnit * 1.9 : entry + riskUnit * 1.9;

  const tpBeforeSlProb = to2(clamp(probability - eventRisk * 0.12 + (mtf - 50) * 0.11, 4, 95));
  const expectedMovePct = to2(clamp((riskUnit / Math.max(entry, 0.00001)) * 100 * 1.6, 0.2, 14));

  const projectedPath: Array<{ index: number; price: number }> = [];
  const steps = 12;
  const slope =
    action === "BUY"
      ? avgRange * 0.28
      : action === "SELL"
        ? -avgRange * 0.28
        : (direction === "UP" ? 1 : direction === "DOWN" ? -1 : 0) * avgRange * 0.08;

  for (let i = 1; i <= steps; i++) {
    const wave = Math.sin(i / 1.9) * avgRange * 0.12;
    projectedPath.push({ index: candles.length - 1 + i, price: to2(entry + slope * i + wave) });
  }

  const note =
    action === "BUY"
      ? "Bullish directional alignment. Use pullback entries; invalidate if structure breaks below stop zone."
      : action === "SELL"
        ? "Bearish directional alignment. Prefer short entries on weak bounce; invalidate on reclaim above stop zone."
        : `WAIT mode: ${abstainReason ?? "insufficient edge"}`;

  return {
    pair,
    timeframe,
    candles,
    events: events.slice(-40),
    liquidityLevels,
    direction,
    regime,
    action,
    probability,
    confidenceScore: to2(confidenceScore),
    eventRisk,
    abstainReason,
    mtfAlignment: to2(mtf),
    entry: to2(entry),
    stopLoss: to2(stopLoss),
    takeProfit: to2(takeProfit),
    note,
    projectedPath,
    nextMove: {
      tpBeforeSlProb,
      expectedMovePct,
      confidenceLow: to2(clamp(tpBeforeSlProb - 9, 1, 95)),
      confidenceHigh: to2(clamp(tpBeforeSlProb + 9, 1, 99)),
    },
    orderFlow: {
      bookImbalance: orderFlow.bookImbalance,
      fundingRate: orderFlow.fundingRate !== null ? to2(orderFlow.fundingRate) : null,
      openInterest: orderFlow.openInterest !== null ? to2(orderFlow.openInterest) : null,
    },
    reliability: {
      wsRecommended: true,
      reconnectBackfillRecommended: true,
    },
  };
}
