import { pool } from "@/db";
import { fetchBestKlines } from "@/lib/ohlcv-providers";
import WebSocket from "ws";
import type { Timeframe } from "@/lib/timeframes";

export type StreamCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
};

type StreamStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error" | "halted";
type TransportMode = "ws" | "poll" | "none";

type StreamEntry = {
  key: string;
  symbol: string;
  timeframe: Timeframe;
  interval: string;
  status: StreamStatus;
  transport: TransportMode;
  lastError: string | null;
  ws: WebSocket | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  lastEventTime: number | null;
  lastBackfillAt: number | null;
  gapCount: number;
  candles: StreamCandle[];
  updatedAt: number;
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

const intervalMsMap: Record<Timeframe, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

const MAX_RECONNECT_ATTEMPTS = 8;

function normalizePair(input: string) {
  const s = input.toUpperCase().replace(/[^A-Z]/g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function toNum(v: string) {
  return Number(v);
}

function mergeCandles(current: StreamCandle[], incoming: StreamCandle[]) {
  const map = new Map<number, StreamCandle>();
  [...current, ...incoming].forEach((c) => {
    const existing = map.get(c.openTime);
    if (!existing || c.closeTime >= existing.closeTime || c.closed) map.set(c.openTime, c);
  });
  return [...map.values()].sort((a, b) => a.openTime - b.openTime).slice(-700);
}

async function persistCandle(symbol: string, timeframe: Timeframe, candle: StreamCandle, source: "stream" | "backfill") {
  if (!candle.closed) return;

  await pool.query(
    `
      INSERT INTO stream_candles
      (symbol, timeframe, open_time, close_time, open, high, low, close, volume, source)
      VALUES ($1,$2,to_timestamp($3 / 1000.0),to_timestamp($4 / 1000.0),$5,$6,$7,$8,$9,$10)
      ON CONFLICT (symbol, timeframe, open_time)
      DO UPDATE SET
        close_time = EXCLUDED.close_time,
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume,
        source = EXCLUDED.source
    `,
    [symbol, timeframe, candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume, source],
  );
}

async function persistCandlesBatch(symbol: string, timeframe: Timeframe, candles: StreamCandle[], source: "stream" | "backfill") {
  const closed = candles.filter((c) => c.closed).slice(-300);
  for (const candle of closed) {
    await persistCandle(symbol, timeframe, candle, source);
  }
}

async function fetchBackfill(symbol: string, timeframe: Timeframe, limit = 240): Promise<StreamCandle[]> {
  const { candles } = await fetchBestKlines(symbol, timeframe, Math.min(limit, 500));
  return candles.map((k) => ({
    openTime: k.openTime,
    closeTime: k.closeTime,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    closed: true,
  }));
}

class StreamManager {
  private streams = new Map<string, StreamEntry>();

  getKey(symbol: string, timeframe: Timeframe) {
    return `${normalizePair(symbol)}:${timeframe}`;
  }

  async start(symbolRaw: string, timeframe: Timeframe) {
    const symbol = normalizePair(symbolRaw);
    const key = this.getKey(symbol, timeframe);
    const existing = this.streams.get(key);

    if (existing && ["connected", "connecting", "reconnecting"].includes(existing.status)) {
      return existing;
    }

    const entry: StreamEntry =
      existing ?? {
        key,
        symbol,
        timeframe,
        interval: intervalMap[timeframe],
        status: "idle",
        transport: "none",
        lastError: null,
        ws: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        pollTimer: null,
        lastEventTime: null,
        lastBackfillAt: null,
        gapCount: 0,
        candles: [],
        updatedAt: Date.now(),
      };

    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    if (entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }

    entry.reconnectAttempts = 0;
    entry.status = "connecting";
    entry.transport = "ws";
    entry.lastError = null;

    this.streams.set(key, entry);
    await this.connect(entry);
    return entry;
  }

  private async connect(entry: StreamEntry) {
    const lower = entry.symbol.toLowerCase();
    const stream = `${lower}@kline_${entry.interval}`;
    const url = `wss://stream.binance.com:9443/ws/${stream}`;

    entry.status = entry.reconnectAttempts > 0 ? "reconnecting" : "connecting";
    entry.transport = "ws";
    entry.updatedAt = Date.now();

    try {
      const backfilled = await fetchBackfill(entry.symbol, entry.timeframe, 260);
      entry.candles = mergeCandles(entry.candles, backfilled);
      await persistCandlesBatch(entry.symbol, entry.timeframe, backfilled, "backfill");
      entry.lastBackfillAt = Date.now();
      entry.lastError = null;
      entry.updatedAt = Date.now();
    } catch (e) {
      entry.lastError = e instanceof Error ? e.message : "Backfill prefetch failed";
    }

    try {
      const ws = new WebSocket(url);
      entry.ws = ws;

      ws.on("open", () => {
        entry.status = "connected";
        entry.transport = "ws";
        entry.reconnectAttempts = 0;
        entry.lastError = null;
        entry.updatedAt = Date.now();
      });

      ws.on("message", async (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(String(data)) as {
            E: number;
            k: { t: number; T: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
          };

          const k = msg.k;
          const candle: StreamCandle = {
            openTime: k.t,
            closeTime: k.T,
            open: toNum(k.o),
            high: toNum(k.h),
            low: toNum(k.l),
            close: toNum(k.c),
            volume: toNum(k.v),
            closed: Boolean(k.x),
          };

          const previous = entry.candles[entry.candles.length - 1];
          const intervalMs = intervalMsMap[entry.timeframe];

          if (previous && candle.openTime - previous.openTime > intervalMs * 1.5) {
            entry.gapCount += 1;
            try {
              const refill = await fetchBackfill(entry.symbol, entry.timeframe, 260);
              entry.candles = mergeCandles(entry.candles, refill);
              await persistCandlesBatch(entry.symbol, entry.timeframe, refill, "backfill");
              entry.lastBackfillAt = Date.now();
            } catch (e) {
              entry.lastError = e instanceof Error ? e.message : "Gap refill failed";
            }
          }

          entry.candles = mergeCandles(entry.candles, [candle]);
          if (candle.closed) await persistCandle(entry.symbol, entry.timeframe, candle, "stream");
          entry.lastEventTime = msg.E;
          entry.updatedAt = Date.now();
        } catch (e) {
          entry.status = "error";
          entry.lastError = e instanceof Error ? e.message : "WS parse failed";
          entry.updatedAt = Date.now();
        }
      });

      ws.on("close", () => this.scheduleReconnect(entry, "ws_close"));
      ws.on("error", (err) => this.scheduleReconnect(entry, err instanceof Error ? err.message : "ws_error"));
    } catch (e) {
      this.scheduleReconnect(entry, e instanceof Error ? e.message : "ws_init_failed");
    }
  }

  private activatePollingFallback(entry: StreamEntry, reason: string) {
    if (entry.pollTimer) return;

    if (entry.ws) {
      try {
        entry.ws.removeAllListeners();
        entry.ws.close();
      } catch {
        // ignore
      }
      entry.ws = null;
    }

    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    entry.status = "connected";
    entry.transport = "poll";
    entry.lastError = `WS fallback: ${reason}`;
    entry.updatedAt = Date.now();

    const interval = Math.max(15_000, Math.floor(intervalMsMap[entry.timeframe] / 2));

    entry.pollTimer = setInterval(async () => {
      try {
        const refill = await fetchBackfill(entry.symbol, entry.timeframe, 260);
        entry.candles = mergeCandles(entry.candles, refill);
        await persistCandlesBatch(entry.symbol, entry.timeframe, refill, "backfill");
        entry.lastBackfillAt = Date.now();
        entry.lastEventTime = Date.now();
        entry.updatedAt = Date.now();
      } catch (e) {
        entry.lastError = e instanceof Error ? e.message : "Polling backfill failed";
        entry.updatedAt = Date.now();
      }
    }, interval);
  }

  private scheduleReconnect(entry: StreamEntry, reason: string) {
    entry.lastError = reason;

    if (reason.includes("451")) {
      this.activatePollingFallback(entry, reason);
      return;
    }

    if (entry.reconnectTimer) return;

    if (entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      entry.status = "halted";
      entry.updatedAt = Date.now();
      this.activatePollingFallback(entry, reason);
      return;
    }

    entry.status = "reconnecting";
    entry.transport = "ws";
    entry.updatedAt = Date.now();
    entry.reconnectAttempts += 1;

    if (entry.ws) {
      try {
        entry.ws.removeAllListeners();
        entry.ws.close();
      } catch {
        // ignore
      }
      entry.ws = null;
    }

    const delay = Math.min(20_000, 1_000 * 2 ** Math.min(entry.reconnectAttempts, 5));
    entry.reconnectTimer = setTimeout(() => {
      entry.reconnectTimer = null;
      this.connect(entry).catch((e) => {
        entry.status = "error";
        entry.lastError = e instanceof Error ? e.message : "Reconnect connect failed";
      });
    }, delay);
  }

  stop(symbolRaw: string, timeframe: Timeframe) {
    const symbol = normalizePair(symbolRaw);
    const key = this.getKey(symbol, timeframe);
    const entry = this.streams.get(key);
    if (!entry) return false;

    if (entry.ws) {
      try {
        entry.ws.removeAllListeners();
        entry.ws.close();
      } catch {
        // ignore
      }
      entry.ws = null;
    }

    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }

    if (entry.pollTimer) {
      clearInterval(entry.pollTimer);
      entry.pollTimer = null;
    }

    entry.status = "idle";
    entry.transport = "none";
    entry.updatedAt = Date.now();
    this.streams.delete(key);
    return true;
  }

  getStatus() {
    return [...this.streams.values()].map((s) => ({
      key: s.key,
      symbol: s.symbol,
      timeframe: s.timeframe,
      status: s.status,
      transport: s.transport,
      lastError: s.lastError,
      reconnectAttempts: s.reconnectAttempts,
      lastEventTime: s.lastEventTime,
      lastBackfillAt: s.lastBackfillAt,
      gapCount: s.gapCount,
      candles: s.candles.length,
      lastPrice: s.candles[s.candles.length - 1]?.close ?? null,
      updatedAt: s.updatedAt,
    }));
  }

  getCandles(symbolRaw: string, timeframe: Timeframe) {
    const symbol = normalizePair(symbolRaw);
    const key = this.getKey(symbol, timeframe);
    return this.streams.get(key)?.candles ?? null;
  }
}

const globalForStream = globalThis as typeof globalThis & { __streamManager?: StreamManager };

export const streamManager = globalForStream.__streamManager ?? new StreamManager();

if (process.env.NODE_ENV !== "production") {
  globalForStream.__streamManager = streamManager;
}
