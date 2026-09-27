import type { Timeframe } from "@/lib/timeframes";

export type NormalizedCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

const binanceInterval: Record<Timeframe, string> = {
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1h",
  "4h": "4h",
  "6h": "6h",
  "1d": "1d",
  "1w": "1w",
};

const timeframeMs: Record<Timeframe, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

function normalizeUsdtPair(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function toNum(v: string | number) {
  return Number(v);
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function fromBinance(symbol: string, timeframe: Timeframe, limit: number) {
  const interval = binanceInterval[timeframe];
  const rows = (await fetchJson(
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 500)}`,
  )) as Array<[number, string, string, string, string, string, number, string, number, string, string, string]>;

  return rows.map((k) => ({
    openTime: k[0],
    closeTime: k[6],
    open: toNum(k[1]),
    high: toNum(k[2]),
    low: toNum(k[3]),
    close: toNum(k[4]),
    volume: toNum(k[5]),
    closed: true,
  })) as NormalizedCandle[];
}

async function fromBinanceVision(symbol: string, timeframe: Timeframe, limit: number) {
  const interval = binanceInterval[timeframe];
  const rows = (await fetchJson(
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${Math.min(limit, 500)}`,
  )) as Array<[number, string, string, string, string, string, number, string, number, string, string, string]>;

  return rows.map((k) => ({
    openTime: k[0],
    closeTime: k[6],
    open: toNum(k[1]),
    high: toNum(k[2]),
    low: toNum(k[3]),
    close: toNum(k[4]),
    volume: toNum(k[5]),
    closed: true,
  })) as NormalizedCandle[];
}

async function fromBybit(symbol: string, timeframe: Timeframe, limit: number) {
  const intervalMap: Record<Timeframe, string> = {
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "4h": "240",
    "6h": "360",
    "1d": "D",
    "1w": "W",
  };

  const iv = intervalMap[timeframe];
  const payload = (await fetchJson(
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}&interval=${iv}&limit=${Math.min(limit, 1000)}`,
  )) as {
    retCode: number;
    result?: { list?: Array<[string, string, string, string, string, string, string]> };
  };

  if (payload.retCode !== 0 || !payload.result?.list?.length) {
    throw new Error(`bybit_ret_${payload.retCode}`);
  }

  return payload.result.list
    .map((k) => {
      const openTime = Number(k[0]);
      return {
        openTime,
        closeTime: openTime + timeframeMs[timeframe] - 1,
        open: toNum(k[1]),
        high: toNum(k[2]),
        low: toNum(k[3]),
        close: toNum(k[4]),
        volume: toNum(k[5]),
        closed: true,
      };
    })
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

async function fromOkx(symbol: string, timeframe: Timeframe, limit: number) {
  const barMap: Record<Timeframe, string> = {
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1H",
    "4h": "4H",
    "6h": "6H",
    "1d": "1D",
    "1w": "1W",
  };

  const base = symbol.replace(/USDT$/, "");
  const instId = `${base}-USDT`;
  const bar = barMap[timeframe];

  const payload = (await fetchJson(
    `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit, 300)}`,
  )) as {
    code: string;
    data?: Array<[string, string, string, string, string, string, string, string, string]>;
  };

  if (payload.code !== "0" || !payload.data?.length) {
    throw new Error(`okx_code_${payload.code}`);
  }

  return payload.data
    .map((k) => {
      const openTime = Number(k[0]);
      return {
        openTime,
        closeTime: openTime + timeframeMs[timeframe] - 1,
        open: toNum(k[1]),
        high: toNum(k[2]),
        low: toNum(k[3]),
        close: toNum(k[4]),
        volume: toNum(k[5]),
        closed: true,
      };
    })
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

async function fromCoinbase(symbol: string, timeframe: Timeframe, limit: number) {
  const granularity: Partial<Record<Timeframe, number>> = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "6h": 21600,
    "1d": 86400,
  };

  const gran = granularity[timeframe];
  if (!gran) throw new Error("coinbase_unsupported_tf");

  const base = symbol.replace(/USDT$/, "");
  const product = `${base}-USD`;
  const rows = (await fetchJson(
    `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${gran}`,
  )) as Array<[number, number, number, number, number, number]>;

  if (!rows.length) throw new Error("coinbase_empty");

  return rows
    .map((k) => {
      const openTime = k[0] * 1000;
      return {
        openTime,
        closeTime: openTime + timeframeMs[timeframe] - 1,
        open: toNum(k[3]),
        high: toNum(k[2]),
        low: toNum(k[1]),
        close: toNum(k[4]),
        volume: toNum(k[5]),
        closed: true,
      };
    })
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
}

export async function fetchBestKlines(symbolInput: string, timeframe: Timeframe, limit = 240) {
  const symbol = normalizeUsdtPair(symbolInput);
  const errors: string[] = [];

  const providers: Array<{
    name: string;
    fn: (symbol: string, timeframe: Timeframe, limit: number) => Promise<NormalizedCandle[]>;
  }> = [
    { name: "binance", fn: fromBinance },
    { name: "binanceVision", fn: fromBinanceVision },
    { name: "bybit", fn: fromBybit },
    { name: "okx", fn: fromOkx },
    { name: "coinbase", fn: fromCoinbase },
  ];

  for (const p of providers) {
    try {
      const candles = await p.fn(symbol, timeframe, limit);
      if (candles.length >= 30) {
        return { provider: p.name, candles };
      }
      errors.push(`${p.name}:insufficient_${candles.length}`);
    } catch (e) {
      errors.push(`${p.name}:${e instanceof Error ? e.message : "error"}`);
    }
  }

  throw new Error(`All kline providers failed for ${symbol}. ${errors.join(" | ")}`);
}
