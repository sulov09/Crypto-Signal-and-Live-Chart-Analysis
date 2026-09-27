"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { TIMEFRAMES, type Timeframe } from "@/lib/timeframes";

type Signal = {
  coinId: string;
  symbol: string;
  name: string;
  timeframe: Timeframe;
  action: "BUY" | "SELL" | "WAIT";
  score: number;
  probability: number;
  entryPrice: number;
  entryLow?: number;
  entryHigh?: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  note: string;
  factors: Record<string, number>;
  regime?: "TRENDING" | "RANGING" | "HIGH_VOL_EVENT";
  abstainReason?: string | null;
  eventRisk?: number;
  alignmentScore?: number;
  htfConfirmation?: number;
  buyIndex?: number;
  riskIndex?: number;
  scalpSetup?: "READY" | "BUILDING" | "LATE" | "AVOID";
  setupState?: "BUILDING" | "READY" | "TRIGGERED" | "EXPIRED";
  setupExpiresAt?: string;
  distanceToEntryPct?: number;
  signalArrow?: "UP_RIGHT" | "DOWN_RIGHT" | "FLAT";
  notificationReady?: boolean;
  nextMove?: {
    tpBeforeSlProb: number;
    expectedMovePct: number;
    confidenceLow: number;
    confidenceHigh: number;
  };
};

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

type LiveAnalysis = {
  pair: string;
  timeframe: Timeframe;
  candles: Array<{ openTime: number; open: number; high: number; low: number; close: number; volume: number }>;
  events: Array<{ type: string; index: number; price: number; side: "bullish" | "bearish" | "neutral"; label: string }>;
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
  nextMove: { tpBeforeSlProb: number; expectedMovePct: number; confidenceLow: number; confidenceHigh: number };
  orderFlow: { bookImbalance: number; fundingRate: number | null; openInterest: number | null };
  reliability: { wsRecommended: boolean; reconnectBackfillRecommended: boolean };
};

type AlertRow = {
  id: number;
  symbol: string;
  timeframe: string;
  action: string;
  probability: number;
  telegramDelivered: boolean;
  createdAt: string;
};

type BacktestReport = {
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
  walkForward: { windows: number; avgWinRate: number; avgNetR: number };
  monteCarlo: { meanR: number; p10R: number; p90R: number };
};

type QualityMetrics = {
  sampleSize: number;
  brierScore: number;
  precisionAt70: number;
  averagePredictedProb: number;
  realizedWinRate: number;
  calibrationGap: number;
  abstainRate: number;
  coverageRate: number;
  pnlR: number;
  regimeBreakdown: Record<string, { count: number; winRate: number }>;
};

type StreamHealth = {
  key: string;
  symbol: string;
  timeframe: Timeframe;
  status: "idle" | "connecting" | "connected" | "reconnecting" | "error" | "halted";
  transport: "ws" | "poll" | "none";
  lastError: string | null;
  reconnectAttempts: number;
  lastEventTime: number | null;
  lastBackfillAt: number | null;
  gapCount: number;
  candles: number;
  lastPrice: number | null;
  updatedAt: number;
};

type ReplayResponse = {
  symbol: string;
  timeframe: Timeframe;
  count: number;
  candles: Array<{ openTime: string; closeTime: string; open: number; high: number; low: number; close: number; volume: number; source: string }>;
  coverage: { earliest: string | null; latest: string | null };
};

type ReplayFrame = {
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

type ReplaySimulationResponse = {
  symbol: string;
  timeframe: Timeframe;
  candles: Array<{ openTime: string; closeTime: string; open: number; high: number; low: number; close: number; volume: number }>;
  simulation: {
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
};

type DashboardProps = {
  initialSignals: Signal[];
  initialProfile: InitialProfile;
};

const actionStyles: Record<Signal["action"], string> = {
  BUY: "bg-emerald-500/20 text-emerald-300",
  SELL: "bg-rose-500/20 text-rose-300",
  WAIT: "bg-amber-500/20 text-amber-300",
};

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function tfMs(tf: Timeframe) {
  const map: Record<Timeframe, number> = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  };
  return map[tf];
}

function formatRemaining(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatExpiry(iso?: string) {
  if (!iso) return "n/a";
  const left = new Date(iso).getTime() - Date.now();
  return left <= 0 ? "expired" : formatRemaining(left);
}

function clampN(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function LiveAnalysisChart({
  analysis,
  livePrice,
}: {
  analysis: LiveAnalysis;
  livePrice: number | null;
}) {
  const shortEvent = (eventType: string) => {
    if (eventType === "IMBALANCE") return "IMB";
    if (eventType === "LIQUIDITY") return "LIQ";
    if (eventType === "ORDER_BLOCK") return "ORB";
    return eventType;
  };
  const width = 980;
  const height = 330;
  const padX = 28;
  const padY = 24;

  const [chartMode, setChartMode] = useState<"line" | "candles">("line");
  const [visibleCount, setVisibleCount] = useState(100);
  const [panBars, setPanBars] = useState(0);
  const [panYRatio, setPanYRatio] = useState(0);
  const [align, setAlign] = useState<"right" | "center" | "left">("right");
  const [hoverCandleIndex, setHoverCandleIndex] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const dragRef = useRef<{ x: number; y: number; panBars: number; panYRatio: number } | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const total = analysis.candles.length;
  const maxStart = Math.max(total - visibleCount, 0);

  const baseStart =
    align === "right"
      ? maxStart
      : align === "center"
        ? Math.max(0, Math.floor((total - visibleCount) / 2))
        : 0;

  const startIndex = Math.max(0, Math.min(maxStart, baseStart - panBars));
  const visibleCandles = analysis.candles.slice(startIndex, startIndex + visibleCount);

  const projectedInView = analysis.projectedPath.filter(
    (p) => p.index >= startIndex && p.index <= startIndex + visibleCount + 8,
  );

  const lastVisibleClose = visibleCandles[visibleCandles.length - 1]?.close ?? analysis.entry;
  const distancePct = livePrice
    ? Math.abs((livePrice - lastVisibleClose) / Math.max(lastVisibleClose, 0.000001)) * 100
    : null;
  const safeLivePrice = livePrice !== null && distancePct !== null && distancePct <= 35 ? livePrice : null;

  const allPrices = [
    ...visibleCandles.flatMap((c) => [c.high, c.low]),
    ...projectedInView.map((p) => p.price),
    analysis.entry,
    analysis.stopLoss,
    analysis.takeProfit,
    ...(safeLivePrice !== null ? [safeLivePrice] : []),
  ];

  const rawMin = Math.min(...allPrices);
  const rawMax = Math.max(...allPrices);
  const rawSpan = Math.max(rawMax - rawMin, 0.000001);
  const centerShift = rawSpan * panYRatio;
  const min = rawMin + centerShift;
  const max = rawMax + centerShift;
  const span = Math.max(max - min, 0.000001);

  const maxX = Math.max(
    startIndex + visibleCandles.length - 1,
    projectedInView[projectedInView.length - 1]?.index ?? 0,
  );
  const xSpan = Math.max(maxX - startIndex, 1);

  const x = (i: number) => padX + ((i - startIndex) / xSpan) * (width - padX * 2);
  const y = (p: number) => height - padY - ((p - min) / span) * (height - padY * 2);

  const closePath = visibleCandles
    .map((c, i) => `${i === 0 ? "M" : "L"}${x(startIndex + i)} ${y(c.close)}`)
    .join(" ");

  const projPath = projectedInView
    .map((c, i) => `${i === 0 ? "M" : "L"}${x(c.index)} ${y(c.price)}`)
    .join(" ");

  const candleBodyW = Math.max(3, ((width - padX * 2) / Math.max(visibleCandles.length, 1)) * 0.55);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panBars,
      panYRatio,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const idx = Math.round(((px - padX) / (width - padX * 2)) * xSpan) + startIndex;
    setHoverCandleIndex(clampN(idx, startIndex, startIndex + visibleCandles.length - 1));

    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;

    const barsShift = Math.round(dx / 8);
    setPanBars(dragRef.current.panBars - barsShift);
    setPanYRatio(Math.max(-1.2, Math.min(1.2, dragRef.current.panYRatio + dy / 280)));
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const zoomIn = () => setVisibleCount((v) => Math.max(25, v - 15));
  const zoomOut = () => setVisibleCount((v) => Math.min(Math.max(total, 40), v + 15));
  const panLeft = () => setPanBars((v) => v + 8);
  const panRight = () => setPanBars((v) => v - 8);
  const panUp = () => setPanYRatio((v) => Math.max(-1.2, v - 0.08));
  const panDown = () => setPanYRatio((v) => Math.min(1.2, v + 0.08));
  const resetView = () => {
    setVisibleCount(100);
    setPanBars(0);
    setPanYRatio(0);
    setAlign("right");
    setHoverCandleIndex(null);
  };

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  useEffect(() => {
    resetView();
  }, [analysis.pair, analysis.timeframe]);

  const last = visibleCandles[visibleCandles.length - 1] ?? null;
  const candleCloseAt = last ? last.openTime + tfMs(analysis.timeframe) : null;
  const remainingMs = candleCloseAt ? candleCloseAt - nowTs : 0;

  const hoverCandle =
    hoverCandleIndex !== null && hoverCandleIndex >= startIndex && hoverCandleIndex < startIndex + visibleCandles.length
      ? visibleCandles[hoverCandleIndex - startIndex]
      : null;

  const hoverX = hoverCandleIndex !== null ? x(hoverCandleIndex) : null;
  const hoverY = hoverCandle ? y(hoverCandle.close) : null;

  return (
    <div className="space-y-2">
      <div className="grid gap-2 text-xs md:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setChartMode("line")} className={`rounded-lg px-2 py-1 ${chartMode === "line" ? "bg-cyan-600 text-white" : "bg-slate-800"}`}>Line</button>
          <button onClick={() => setChartMode("candles")} className={`rounded-lg px-2 py-1 ${chartMode === "candles" ? "bg-cyan-600 text-white" : "bg-slate-800"}`}>Candles</button>
          <button onClick={zoomIn} className="rounded-lg bg-slate-800 px-2 py-1">Zoom +</button>
          <button onClick={zoomOut} className="rounded-lg bg-slate-800 px-2 py-1">Zoom -</button>
          <button onClick={panLeft} className="rounded-lg bg-slate-800 px-2 py-1">←</button>
          <button onClick={panRight} className="rounded-lg bg-slate-800 px-2 py-1">→</button>
          <button onClick={panUp} className="rounded-lg bg-slate-800 px-2 py-1">↑</button>
          <button onClick={panDown} className="rounded-lg bg-slate-800 px-2 py-1">↓</button>
          <select value={align} onChange={(e) => setAlign(e.target.value as "right" | "center" | "left")} className="rounded-lg bg-slate-800 px-2 py-1">
            <option value="right">Align Right</option>
            <option value="center">Align Center</option>
            <option value="left">Align Left</option>
          </select>
          <button onClick={resetView} className="rounded-lg bg-slate-800 px-2 py-1">Reset View</button>
        </div>

        <div className="rounded-lg bg-slate-900/80 px-2 py-1 text-slate-300">
          {remainingMs > 0 ? `Candle close in: ${formatRemaining(remainingMs)}` : "Waiting next candle..."}
        </div>
      </div>

      <div className="grid gap-2 text-[11px] text-slate-300 md:grid-cols-6">
        {hoverCandle ? (
          <>
            <p className="rounded bg-slate-900/70 px-2 py-1">Time: {new Date(hoverCandle.openTime).toLocaleTimeString()}</p>
            <p className="rounded bg-slate-900/70 px-2 py-1">O: {formatPrice(hoverCandle.open)}</p>
            <p className="rounded bg-slate-900/70 px-2 py-1">H: {formatPrice(hoverCandle.high)}</p>
            <p className="rounded bg-slate-900/70 px-2 py-1">L: {formatPrice(hoverCandle.low)}</p>
            <p className="rounded bg-slate-900/70 px-2 py-1">C: {formatPrice(hoverCandle.close)}</p>
            <p className="rounded bg-slate-900/70 px-2 py-1">Vol: {hoverCandle.volume.toFixed(2)}</p>
          </>
        ) : (
          <p className="rounded bg-slate-900/70 px-2 py-1 md:col-span-6">Move cursor over chart for OHLCV details.</p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-[320px] w-full min-w-[900px] cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            onPointerUp();
            setHoverCandleIndex(null);
          }}
          onWheel={onWheel}
        >
          <rect x="0" y="0" width={width} height={height} fill="#020617" />

          {chartMode === "line" ? (
            <path d={closePath} fill="none" stroke="#e2e8f0" strokeWidth="2" />
          ) : (
            visibleCandles.map((c, i) => {
              const xi = x(startIndex + i);
              const yo = y(c.open);
              const yc = y(c.close);
              const yh = y(c.high);
              const yl = y(c.low);
              const isUp = c.close >= c.open;
              const bodyY = Math.min(yo, yc);
              const bodyH = Math.max(1.5, Math.abs(yo - yc));
              return (
                <g key={`${c.openTime}-${i}`}>
                  <line x1={xi} x2={xi} y1={yh} y2={yl} stroke={isUp ? "#22c55e" : "#f43f5e"} strokeWidth="1.2" />
                  <rect x={xi - candleBodyW / 2} y={bodyY} width={candleBodyW} height={bodyH} fill={isUp ? "#22c55e" : "#f43f5e"} opacity="0.9" />
                </g>
              );
            })
          )}

          <path d={projPath} fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="6 6" />

          <line x1={padX} y1={y(analysis.entry)} x2={width - padX} y2={y(analysis.entry)} stroke="#22d3ee" />
          <line x1={padX} y1={y(analysis.stopLoss)} x2={width - padX} y2={y(analysis.stopLoss)} stroke="#fb7185" strokeDasharray="6 6" />
          <line x1={padX} y1={y(analysis.takeProfit)} x2={width - padX} y2={y(analysis.takeProfit)} stroke="#34d399" strokeDasharray="6 6" />

          {safeLivePrice !== null ? (
            <g>
              <line x1={padX} y1={y(safeLivePrice)} x2={width - padX} y2={y(safeLivePrice)} stroke="#facc15" strokeDasharray="4 5" />
              <text x={width - padX - 105} y={y(safeLivePrice) - 4} fontSize="10" fill="#fde047">LIVE {formatPrice(safeLivePrice)}</text>
            </g>
          ) : livePrice !== null ? (
            <text x={padX + 6} y={padY + 12} fontSize="10" fill="#fbbf24">Live ticker out-of-range for this pair</text>
          ) : null}

          {hoverX !== null && hoverY !== null ? (
            <g>
              <line x1={hoverX} x2={hoverX} y1={padY} y2={height - padY} stroke="#94a3b8" strokeDasharray="3 5" opacity="0.65" />
              <line x1={padX} x2={width - padX} y1={hoverY} y2={hoverY} stroke="#94a3b8" strokeDasharray="3 5" opacity="0.65" />
            </g>
          ) : null}

          {analysis.events
            .filter((e) => e.index >= startIndex && e.index <= startIndex + visibleCount + 8)
            .slice(-18)
            .map((e, i) => (
              <g key={`${e.type}-${e.index}-${i}`}>
                <circle
                  cx={x(e.index)}
                  cy={y(e.price)}
                  r="4"
                  fill={e.side === "bullish" ? "#22c55e" : e.side === "bearish" ? "#f43f5e" : "#38bdf8"}
                />
                <text x={x(e.index) + 6} y={y(e.price) - 6} fontSize="10" fill="#cbd5e1">{shortEvent(e.type)}</text>
              </g>
            ))}
        </svg>
      </div>
    </div>
  );
}

export default function SignalDashboard({ initialSignals, initialProfile }: DashboardProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initialProfile?.preferences?.defaultTimeframe ?? "15m");
  const [signals, setSignals] = useState<Signal[]>(initialSignals);
  const [isScanning, setIsScanning] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<string>(new Date().toISOString());
  const [riskGuard, setRiskGuard] = useState<{ dailyLossLock: boolean; cooldownLock: boolean; lossStreak: number; estimatedLossPct: number } | null>(null);

  const [profile, setProfile] = useState<InitialProfile>(initialProfile);
  const [authHandle, setAuthHandle] = useState("");
  const [watchlistText, setWatchlistText] = useState(initialProfile?.preferences?.watchlist.join(",") ?? "BTC,ETH,SOL");
  const [riskPerTradePct, setRiskPerTradePct] = useState(initialProfile?.preferences?.riskPerTradePct ?? 1);
  const [maxDailyLossPct, setMaxDailyLossPct] = useState(initialProfile?.preferences?.maxDailyLossPct ?? 3);
  const [cooldownAfterLosses, setCooldownAfterLosses] = useState(initialProfile?.preferences?.cooldownAfterLosses ?? 2);
  const [telegramEnabled, setTelegramEnabled] = useState(initialProfile?.preferences?.telegramEnabled ?? false);
  const [telegramChatId, setTelegramChatId] = useState(initialProfile?.preferences?.telegramChatId ?? "");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(initialProfile?.preferences?.autoRefreshSeconds ?? 60);

  const [searchCoin, setSearchCoin] = useState("BTC");
  const [searchResult, setSearchResult] = useState<Signal | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [autoScanOn, setAutoScanOn] = useState(true);
  const [autoLiveOn, setAutoLiveOn] = useState(true);

  const [liveCoin, setLiveCoin] = useState("BTC");
  const [liveTimeframe, setLiveTimeframe] = useState<Timeframe>("15m");
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveAnalysis, setLiveAnalysis] = useState<LiveAnalysis | null>(null);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [quality, setQuality] = useState<QualityMetrics | null>(null);

  const [backtestCoin, setBacktestCoin] = useState("BTC");
  const [backtestTimeframe, setBacktestTimeframe] = useState<Timeframe>("15m");
  const [lookback, setLookback] = useState(280);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtest, setBacktest] = useState<BacktestReport | null>(null);

  const [replayCoin, setReplayCoin] = useState("BTC");
  const [replayTimeframe, setReplayTimeframe] = useState<Timeframe>("15m");
  const [replayLimit, setReplayLimit] = useState(240);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayData, setReplayData] = useState<ReplayResponse | null>(null);
  const [replaySimLoading, setReplaySimLoading] = useState(false);
  const [replaySim, setReplaySim] = useState<ReplaySimulationResponse | null>(null);
  const [replayCursor, setReplayCursor] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeedMs, setReplaySpeedMs] = useState(700);

  const [wsPrice, setWsPrice] = useState<number | null>(null);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "connected" | "reconnecting" | "error" | "halted">("idle");
  const [serverStream, setServerStream] = useState<StreamHealth | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const wsAttemptsRef = useRef(0);
  const wsSessionRef = useRef(0);
  const autoRecoverTsRef = useRef(0);
  const lastSetupRef = useRef<Record<string, string>>({});

  const strongestSignal = useMemo(() => [...signals].sort((a, b) => b.probability - a.probability)[0] ?? null, [signals]);
  const replayCurrentFrame = useMemo(() => {
    if (!replaySim?.simulation.frames.length) return null;
    return replaySim.simulation.frames[Math.min(replayCursor, replaySim.simulation.frames.length - 1)] ?? null;
  }, [replaySim, replayCursor]);

  async function loadAlerts() {
    const res = await fetch("/api/alerts/history");
    const data = await res.json();
    if (data.ok) setAlerts(data.alerts);
  }

  async function loadQuality() {
    const res = await fetch("/api/quality");
    const data = await res.json();
    if (data.ok) setQuality(data.metrics);
  }

  async function refreshProfile() {
    const res = await fetch("/api/profile");
    const data = await res.json();
    if (data.ok) setProfile(data.profile);
  }

  async function runScan() {
    try {
      setIsScanning(true);
      const res = await fetch("/api/signals/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeframe }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Scan failed");
      const nextSignals = data.signals as Signal[];
      setSignals(nextSignals);
      setLastRunAt(data.generatedAt ?? new Date().toISOString());
      setRiskGuard(data.riskGuard ?? null);

      nextSignals.forEach((s) => {
        const key = `${s.symbol}-${s.timeframe}`;
        const prev = lastSetupRef.current[key] ?? "";
        const now = s.scalpSetup ?? "";

        if (s.action === "BUY" && now === "READY" && prev !== "READY") {
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification(`Scalp BUY confirmed: ${s.symbol}`, {
              body: `TF ${s.timeframe} • BuyIndex ${s.buyIndex ?? "-"} • Risk ${s.riskIndex ?? "-"} • TP ${s.takeProfit}`,
            });
          }
        }

        lastSetupRef.current[key] = now;
      });

      await loadAlerts();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }

  async function runSearch() {
    try {
      setSearchError(null);
      setSearchResult(null);
      const res = await fetch(`/api/signals/search?coin=${encodeURIComponent(searchCoin)}&timeframe=${timeframe}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Search failed");
      setSearchResult(data.signal);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    }
  }

  async function runLiveAnalysis() {
    try {
      setLiveLoading(true);
      setLiveError(null);
      const res = await fetch(`/api/live-analysis?coin=${encodeURIComponent(liveCoin)}&timeframe=${liveTimeframe}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Live analysis failed");
      setLiveAnalysis(data.analysis);
      setServerStream(data.stream ?? null);
    } catch (error) {
      setLiveAnalysis(null);
      setLiveError(error instanceof Error ? error.message : "Live analysis failed");
    } finally {
      setLiveLoading(false);
    }
  }

  async function runBacktestPanel() {
    try {
      setBacktestLoading(true);
      const res = await fetch(`/api/backtest?coin=${encodeURIComponent(backtestCoin)}&timeframe=${backtestTimeframe}&lookback=${lookback}`);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Backtest failed");
      setBacktest(data.report);
      await loadQuality();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Backtest failed");
    } finally {
      setBacktestLoading(false);
    }
  }

  async function loadReplay() {
    try {
      setReplayLoading(true);
      const res = await fetch(
        `/api/replay?symbol=${encodeURIComponent(replayCoin)}&timeframe=${replayTimeframe}&limit=${replayLimit}`,
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Replay fetch failed");
      setReplayData(data as ReplayResponse);
      setReplaySim(null);
      setReplayCursor(0);
      setReplayPlaying(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Replay fetch failed");
    } finally {
      setReplayLoading(false);
    }
  }

  async function loadReplaySimulation() {
    try {
      setReplaySimLoading(true);
      const res = await fetch(
        `/api/replay/simulate?symbol=${encodeURIComponent(replayCoin)}&timeframe=${replayTimeframe}&limit=${Math.max(
          replayLimit,
          200,
        )}`,
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Replay simulation failed");
      setReplaySim(data as ReplaySimulationResponse);
      setReplayCursor(0);
      setReplayPlaying(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Replay simulation failed");
    } finally {
      setReplaySimLoading(false);
    }
  }

  async function syncServerStream() {
    const res = await fetch(`/api/stream?symbol=${encodeURIComponent(liveCoin)}&timeframe=${liveTimeframe}`);
    const data = await res.json();
    if (data.ok && Array.isArray(data.status)) {
      const target = data.status.find(
        (s: StreamHealth) => s.symbol === `${liveCoin.toUpperCase().replace(/[^A-Z]/g, "").replace(/USDT$/, "")}USDT` && s.timeframe === liveTimeframe,
      );
      setServerStream(target ?? null);
    }
  }

  async function startServerStream() {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start", symbol: liveCoin, timeframe: liveTimeframe }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return alert(data.error ?? "Failed to start stream");
    }
    await syncServerStream();
  }

  async function stopServerStream() {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop", symbol: liveCoin, timeframe: liveTimeframe }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return alert(data.error ?? "Failed to stop stream");
    }
    setServerStream(null);
  }

  async function recoverServerStream() {
    const res = await fetch("/api/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "recover", symbol: liveCoin, timeframe: liveTimeframe }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return alert(data.error ?? "Failed to recover stream");
    }

    await syncServerStream();
    await runLiveAnalysis();
  }

  async function signIn() {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: authHandle }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return alert(data.error ?? "Sign in failed");
    setProfile(data.profile);
    setTimeframe(data.profile?.preferences?.defaultTimeframe ?? "15m");
    await loadAlerts();
    await loadQuality();
  }

  async function signOut() {
    await fetch("/api/profile", { method: "DELETE" });
    setProfile(null);
  }

  async function savePreferences() {
    const watchlist = watchlistText.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultTimeframe: timeframe, watchlist, riskPerTradePct, maxDailyLossPct, cooldownAfterLosses, telegramEnabled, telegramChatId, autoRefreshSeconds }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return alert(data.error ?? "Save failed");
    await refreshProfile();
    alert("Preferences updated");
  }

  async function testTelegram() {
    const res = await fetch("/api/alerts/telegram/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chatId: telegramChatId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return alert(data.error ?? "Telegram test failed");
    alert("Telegram test sent");
  }

  useEffect(() => {
    loadAlerts();
    loadQuality();
  }, []);

  useEffect(() => {
    startServerStream().catch(() => {
      // ignore bootstrap failure
    });
    const id = window.setInterval(() => {
      syncServerStream().catch(() => {
        // ignore polling failure
      });
    }, 8000);
    return () => window.clearInterval(id);
  }, [liveCoin, liveTimeframe]);

  useEffect(() => {
    const coin = liveCoin.trim();
    if (!coin) return;

    const id = window.setTimeout(() => {
      runLiveAnalysis().catch(() => {
        // handled by function
      });
    }, 500);

    return () => window.clearTimeout(id);
  }, [liveCoin, liveTimeframe]);

  useEffect(() => {
    if (!serverStream) return;

    const shouldRecover =
      serverStream.status === "halted" ||
      (serverStream.status === "reconnecting" && serverStream.reconnectAttempts >= 8);

    if (!shouldRecover) return;

    const now = Date.now();
    if (now - autoRecoverTsRef.current < 30_000) return;
    autoRecoverTsRef.current = now;

    recoverServerStream().catch(() => {
      // ignore auto-recovery failure
    });
  }, [serverStream?.status, serverStream?.reconnectAttempts]);

  useEffect(() => {
    runScan().catch(() => {
      // scan errors handled in function
    });
  }, [timeframe]);

  useEffect(() => {
    if (!autoScanOn) return;
    const id = window.setInterval(() => runScan(), Math.max(autoRefreshSeconds, 15) * 1000);
    return () => window.clearInterval(id);
  }, [autoScanOn, autoRefreshSeconds, timeframe]);

  useEffect(() => {
    if (!autoLiveOn) return;
    const id = window.setInterval(() => runLiveAnalysis(), Math.max(autoRefreshSeconds, 15) * 1000);
    return () => window.clearInterval(id);
  }, [autoLiveOn, autoRefreshSeconds, liveCoin, liveTimeframe]);

  useEffect(() => {
    if (!replayPlaying || !replaySim?.simulation.frames.length) return;
    const id = window.setInterval(() => {
      setReplayCursor((prev) => {
        const max = replaySim.simulation.frames.length - 1;
        if (prev >= max) {
          setReplayPlaying(false);
          return max;
        }
        return prev + 1;
      });
    }, replaySpeedMs);

    return () => window.clearInterval(id);
  }, [replayPlaying, replaySim, replaySpeedMs]);

  useEffect(() => {
    const pair = `${liveCoin.toLowerCase().replace(/[^a-z]/g, "")}usdt`;
    if (!pair || typeof window === "undefined") return;

    const sessionId = Date.now();
    wsSessionRef.current = sessionId;
    wsAttemptsRef.current = 0;

    const connect = () => {
      if (wsSessionRef.current !== sessionId) return;

      if (wsAttemptsRef.current >= 10) {
        setWsStatus("halted");
        return;
      }

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }

      setWsStatus((prev) => (prev === "connected" ? "reconnecting" : "connecting"));
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${pair}@miniTicker`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsSessionRef.current !== sessionId) return;
        wsAttemptsRef.current = 0;
        setWsStatus("connected");
      };

      ws.onmessage = (event) => {
        if (wsSessionRef.current !== sessionId) return;
        try {
          const data = JSON.parse(event.data) as { c?: string };
          if (data.c) setWsPrice(Number(data.c));
        } catch {
          setWsStatus("error");
        }
      };

      ws.onerror = () => {
        if (wsSessionRef.current !== sessionId) return;
        setWsStatus("error");
      };

      ws.onclose = () => {
        if (wsSessionRef.current !== sessionId) return;
        wsAttemptsRef.current += 1;
        if (wsAttemptsRef.current >= 10) {
          setWsStatus("halted");
          return;
        }
        setWsStatus("reconnecting");
        if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
        reconnectRef.current = window.setTimeout(connect, 1800);
      };
    };

    setWsPrice(null);
    connect();

    return () => {
      wsSessionRef.current = -1;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
      }
    };
  }, [liveCoin]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
          <h1 className="text-2xl font-semibold">Signal Command Center</h1>
          <p className="mt-2 text-sm text-slate-300">Confluence scanner with abstain mode, regime detection, and quality tracking.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">
              {TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf === "1d" ? "1D" : tf === "1w" ? "1W" : tf}</option>)}
            </select>
            <button onClick={runScan} disabled={isScanning} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">{isScanning ? "Scanning..." : "Run Scan"}</button>
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs"><input type="checkbox" checked={autoScanOn} onChange={(e) => setAutoScanOn(e.target.checked)} /> Auto</label>
            <span className="text-xs text-slate-400">Last: {new Date(lastRunAt).toLocaleTimeString()}</span>
          </div>
          {riskGuard?.dailyLossLock || riskGuard?.cooldownLock ? (
            <p className="mt-3 rounded-lg border border-rose-700/40 bg-rose-900/20 p-2 text-xs text-rose-300">Risk lock active • streak {riskGuard.lossStreak} • estimated daily loss {riskGuard.estimatedLossPct}%</p>
          ) : null}
          {strongestSignal ? (
            <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm">
              Top setup: <b>{strongestSignal.symbol}</b> • {strongestSignal.action} • {strongestSignal.probability}% • {strongestSignal.regime}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
          <h2 className="text-lg font-semibold">Profile & Risk</h2>
          {!profile ? (
            <div className="mt-3 space-y-2">
              <input value={authHandle} onChange={(e) => setAuthHandle(e.target.value)} placeholder="your_handle" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
              <button onClick={signIn} className="w-full rounded-lg bg-violet-500 px-3 py-2 text-sm font-medium">Sign In</button>
            </div>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-cyan-300">@{profile.handle}</p>
              <input value={watchlistText} onChange={(e) => setWatchlistText(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
              <div className="grid grid-cols-3 gap-2">
                <input type="number" step="0.1" value={riskPerTradePct} onChange={(e) => setRiskPerTradePct(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2" />
                <input type="number" step="0.1" value={maxDailyLossPct} onChange={(e) => setMaxDailyLossPct(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2" />
                <input type="number" value={cooldownAfterLosses} onChange={(e) => setCooldownAfterLosses(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-2" />
              </div>
              <input type="number" min={15} max={300} value={autoRefreshSeconds} onChange={(e) => setAutoRefreshSeconds(Number(e.target.value))} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
              <label className="flex items-center gap-2"><input type="checkbox" checked={telegramEnabled} onChange={(e) => setTelegramEnabled(e.target.checked)} /> Telegram alerts</label>
              <input value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="chat id" className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
              <div className="flex gap-2">
                <button onClick={savePreferences} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs">Save</button>
                <button onClick={testTelegram} className="rounded-lg bg-slate-700 px-3 py-2 text-xs">Test TG</button>
                <button onClick={signOut} className="rounded-lg bg-rose-700 px-3 py-2 text-xs">Sign Out</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-lg font-semibold">Top Scalp Opportunities (5m → 4h)</h2>
          <p className="mt-1 text-xs text-slate-400">
            Auto-filtered by higher-timeframe confirmation, structure quality, and risk. Green READY setups are
            notification-grade entries.
          </p>
          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Coin</th>
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3">Direction</th>
                  <th className="py-2 pr-3">HTF Confirm</th>
                  <th className="py-2 pr-3">Buy Index</th>
                  <th className="py-2 pr-3">Risk Index</th>
                  <th className="py-2 pr-3">Entry Zone</th>
                  <th className="py-2 pr-3">State</th>
                  <th className="py-2 pr-3">Expires In</th>
                  <th className="py-2 pr-3">SL</th>
                  <th className="py-2 pr-3">TP</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => {
                  const setup = s.scalpSetup ?? "AVOID";
                  const setupClass =
                    setup === "READY"
                      ? "bg-emerald-500/25 text-emerald-300"
                      : setup === "BUILDING"
                        ? "bg-cyan-500/20 text-cyan-300"
                        : setup === "LATE"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-rose-500/20 text-rose-300";

                  const directionIcon =
                    s.signalArrow === "UP_RIGHT" ? "↗" : s.signalArrow === "DOWN_RIGHT" ? "↘" : "→";

                  return (
                    <tr key={`${s.coinId}-${s.timeframe}`} className="border-t border-slate-800">
                      <td className="py-2 pr-3">
                        <p className="font-medium">{s.symbol}</p>
                        <p className="text-xs text-slate-500">{s.timeframe}</p>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${setupClass}`}>{setup}</span>
                        {s.notificationReady ? <p className="mt-1 text-[10px] text-emerald-300">Signal ON</p> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${actionStyles[s.action]}`}>{directionIcon} {s.action}</span>
                      </td>
                      <td className="py-2 pr-3">{s.htfConfirmation ?? 0}%</td>
                      <td className="py-2 pr-3 font-semibold text-emerald-300">{s.buyIndex ?? 0}</td>
                      <td className="py-2 pr-3 font-semibold text-amber-300">{s.riskIndex ?? 0}</td>
                      <td className="py-2 pr-3">
                        ${s.entryLow ?? s.entryPrice} - ${s.entryHigh ?? s.entryPrice}
                        <p className="text-[10px] text-slate-500">Δ {s.distanceToEntryPct ?? 0}%</p>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-[11px]">{s.setupState ?? "-"}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs">{formatExpiry(s.setupExpiresAt)}</td>
                      <td className="py-2 pr-3">${s.stopLoss}</td>
                      <td className="py-2 pr-3">${s.takeProfit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-lg font-semibold">Coin Search</h2>
          <div className="mt-2 flex gap-2">
            <input value={searchCoin} onChange={(e) => setSearchCoin(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
            <button onClick={runSearch} className="rounded-lg bg-violet-500 px-3 py-2 text-sm">Analyze</button>
          </div>
          {searchError ? <p className="mt-2 text-xs text-rose-300">{searchError}</p> : null}
          {searchResult ? <div className="mt-3 text-sm text-slate-300"><p>{searchResult.action} • {searchResult.probability}% • {searchResult.regime}</p><p className="mt-1">{searchResult.note}</p></div> : null}
        </aside>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Live Analysis Studio</h2>
          <input value={liveCoin} onChange={(e) => setLiveCoin(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
          <select value={liveTimeframe} onChange={(e) => setLiveTimeframe(e.target.value as Timeframe)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">{TIMEFRAMES.map((tf) => <option key={tf} value={tf}>{tf}</option>)}</select>
          <button onClick={runLiveAnalysis} disabled={liveLoading} className="rounded-lg bg-fuchsia-500 px-3 py-2 text-sm">{liveLoading ? "Analyzing..." : "Run"}</button>
          <button onClick={startServerStream} className="rounded-lg border border-cyan-500/60 px-3 py-2 text-xs text-cyan-300">Start Server Stream</button>
          <button onClick={stopServerStream} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Stop Stream</button>
          <button onClick={recoverServerStream} className="rounded-lg border border-amber-500/70 px-3 py-2 text-xs text-amber-300">Recover Stream</button>
          <label className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs"><input type="checkbox" checked={autoLiveOn} onChange={(e) => setAutoLiveOn(e.target.checked)} /> Auto Live</label>
          <span className="text-xs text-slate-400">WS: {wsStatus}{wsPrice ? ` • ${formatPrice(wsPrice)}` : ""}</span>
        </div>

        {serverStream ? (
          <div className="mt-2 grid gap-2 text-xs text-slate-300 md:grid-cols-6">
            <p className="rounded-lg bg-slate-800 p-2">Server: {serverStream.status}</p>
            <p className="rounded-lg bg-slate-800 p-2">Transport: {serverStream.transport}</p>
            <p className="rounded-lg bg-slate-800 p-2">Reconnects: {serverStream.reconnectAttempts}</p>
            <p className="rounded-lg bg-slate-800 p-2">Gaps fixed: {serverStream.gapCount}</p>
            <p className="rounded-lg bg-slate-800 p-2">Cached candles: {serverStream.candles}</p>
            <p className="rounded-lg bg-slate-800 p-2">Backfill: {serverStream.lastBackfillAt ? new Date(serverStream.lastBackfillAt).toLocaleTimeString() : "n/a"}</p>
            {serverStream.lastError ? <p className="rounded-lg bg-rose-900/20 p-2 text-rose-300 md:col-span-6">Last error: {serverStream.lastError}</p> : null}
          </div>
        ) : null}
        {liveError ? <p className="mt-2 text-sm text-rose-300">{liveError}</p> : null}
        {liveAnalysis ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 md:grid-cols-6 text-sm">
              <p className="rounded-lg bg-slate-800 p-2">Pair: {liveAnalysis.pair}</p>
              <p className="rounded-lg bg-slate-800 p-2">Regime: {liveAnalysis.regime}</p>
              <p className="rounded-lg bg-slate-800 p-2">Action: {liveAnalysis.action}</p>
              <p className="rounded-lg bg-slate-800 p-2">Prob: {liveAnalysis.probability}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Event risk: {liveAnalysis.eventRisk}%</p>
              <p className="rounded-lg bg-slate-800 p-2">MTF align: {liveAnalysis.mtfAlignment}%</p>
            </div>
            <LiveAnalysisChart analysis={liveAnalysis} livePrice={wsPrice} />
            <div className="grid gap-2 md:grid-cols-3 text-xs">
              <p className="rounded-lg bg-slate-800 p-2">Book imbalance: {liveAnalysis.orderFlow.bookImbalance}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Funding: {liveAnalysis.orderFlow.fundingRate ?? "n/a"}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Open interest: {liveAnalysis.orderFlow.openInterest ?? "n/a"}</p>
            </div>
            <p className="text-sm text-slate-300">{liveAnalysis.note}</p>
          </div>
        ) : <p className="mt-3 text-sm text-slate-400">Live analysis auto-runs on coin/timeframe changes.</p>}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-lg font-semibold">Backtest Panel</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={backtestCoin} onChange={(e) => setBacktestCoin(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
            <select value={backtestTimeframe} onChange={(e) => setBacktestTimeframe(e.target.value as Timeframe)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">{TIMEFRAMES.map((tf) => <option key={`bt-${tf}`} value={tf}>{tf}</option>)}</select>
            <input type="number" value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
            <button onClick={runBacktestPanel} disabled={backtestLoading} className="rounded-lg bg-cyan-600 px-3 py-2 text-sm">{backtestLoading ? "Running..." : "Run"}</button>
          </div>
          {backtest ? (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <p className="rounded-lg bg-slate-800 p-2">Trades: {backtest.trades}</p>
              <p className="rounded-lg bg-slate-800 p-2">Win rate: {backtest.winRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Net R: {backtest.netR}</p>
              <p className="rounded-lg bg-slate-800 p-2">Max DD: {backtest.maxDrawdownR}</p>
              <p className="rounded-lg bg-slate-800 p-2">Fees R: {backtest.feesR}</p>
              <p className="rounded-lg bg-slate-800 p-2">Slip R: {backtest.slippageR}</p>
              <p className="rounded-lg bg-slate-800 p-2">WF WR: {backtest.walkForward.avgWinRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">MC P10/P90: {backtest.monteCarlo.p10R}/{backtest.monteCarlo.p90R}</p>
            </div>
          ) : <p className="mt-3 text-sm text-slate-400">Run strategy simulation with fees/slippage and robustness checks.</p>}
        </article>

        <article className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <h2 className="text-lg font-semibold">Signal Quality Framework</h2>
          {quality ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <p className="rounded-lg bg-slate-800 p-2">Sample: {quality.sampleSize}</p>
              <p className="rounded-lg bg-slate-800 p-2">Brier: {quality.brierScore}</p>
              <p className="rounded-lg bg-slate-800 p-2">Precision@70: {quality.precisionAt70}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Calibration gap: {quality.calibrationGap}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Coverage: {quality.coverageRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Abstain: {quality.abstainRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Realized WR: {quality.realizedWinRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">PnL R: {quality.pnlR}</p>
            </div>
          ) : <p className="mt-2 text-sm text-slate-400">No quality metrics yet.</p>}

          <h3 className="mt-4 text-sm font-medium">Alert History</h3>
          <div className="mt-2 max-h-40 space-y-2 overflow-auto text-sm">
            {alerts.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2">
                <p>{a.symbol} {a.action} {a.probability}% ({a.timeframe})</p>
                <p className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()} • TG: {a.telegramDelivered ? "sent" : "no"}</p>
              </div>
            ))}
            {!alerts.length ? <p className="text-slate-400">No alerts yet.</p> : null}
          </div>
        </article>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
        <h2 className="text-lg font-semibold">Replay Explorer & Player (Persisted Candles)</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={replayCoin} onChange={(e) => setReplayCoin(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
          <select value={replayTimeframe} onChange={(e) => setReplayTimeframe(e.target.value as Timeframe)} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm">{TIMEFRAMES.map((tf) => <option key={`rp-${tf}`} value={tf}>{tf}</option>)}</select>
          <input type="number" value={replayLimit} onChange={(e) => setReplayLimit(Number(e.target.value))} className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
          <button onClick={loadReplay} disabled={replayLoading} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm">{replayLoading ? "Loading..." : "Load Replay"}</button>
          <button onClick={loadReplaySimulation} disabled={replaySimLoading} className="rounded-lg bg-violet-600 px-3 py-2 text-sm">{replaySimLoading ? "Simulating..." : "Run Replay Sim"}</button>
        </div>

        {replayData ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-slate-300">{replayData.symbol} • {replayData.timeframe} • candles: {replayData.count}</p>
            <p className="text-xs text-slate-400">Coverage: {replayData.coverage.earliest ?? "n/a"} → {replayData.coverage.latest ?? "n/a"}</p>
            <div className="max-h-40 overflow-auto rounded-lg border border-slate-800">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-800/70 text-slate-300"><tr><th className="px-2 py-1">Time</th><th className="px-2 py-1">O</th><th className="px-2 py-1">H</th><th className="px-2 py-1">L</th><th className="px-2 py-1">C</th><th className="px-2 py-1">V</th><th className="px-2 py-1">Src</th></tr></thead>
                <tbody>
                  {replayData.candles.slice(-60).map((c) => (
                    <tr key={c.openTime} className="border-t border-slate-800">
                      <td className="px-2 py-1">{new Date(c.openTime).toLocaleString()}</td>
                      <td className="px-2 py-1">{c.open}</td>
                      <td className="px-2 py-1">{c.high}</td>
                      <td className="px-2 py-1">{c.low}</td>
                      <td className="px-2 py-1">{c.close}</td>
                      <td className="px-2 py-1">{c.volume}</td>
                      <td className="px-2 py-1">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <p className="mt-2 text-sm text-slate-400">Load persisted candles captured by the server stream manager.</p>}

        {replaySim ? (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="grid gap-2 md:grid-cols-6 text-sm">
              <p className="rounded-lg bg-slate-800 p-2">Frames: {replaySim.simulation.summary.totalFrames}</p>
              <p className="rounded-lg bg-slate-800 p-2">Actionable: {replaySim.simulation.summary.actionableFrames}</p>
              <p className="rounded-lg bg-slate-800 p-2">Win rate: {replaySim.simulation.summary.winRate}%</p>
              <p className="rounded-lg bg-slate-800 p-2">Wins/Losses: {replaySim.simulation.summary.wins}/{replaySim.simulation.summary.losses}</p>
              <p className="rounded-lg bg-slate-800 p-2">Net R: {replaySim.simulation.summary.netR}</p>
              <p className="rounded-lg bg-slate-800 p-2">Cursor: {replayCursor + 1}/{Math.max(replaySim.simulation.frames.length, 1)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setReplayPlaying((p) => !p)} className="rounded-lg bg-cyan-600 px-3 py-2 text-xs">{replayPlaying ? "Pause" : "Play"}</button>
              <button onClick={() => { setReplayPlaying(false); setReplayCursor(0); }} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Reset</button>
              <label className="text-xs text-slate-300">Speed</label>
              <select value={replaySpeedMs} onChange={(e) => setReplaySpeedMs(Number(e.target.value))} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs">
                <option value={1200}>0.8x</option>
                <option value={700}>1.5x</option>
                <option value={350}>3x</option>
                <option value={180}>6x</option>
              </select>
            </div>

            <input
              type="range"
              min={0}
              max={Math.max(replaySim.simulation.frames.length - 1, 0)}
              value={Math.min(replayCursor, Math.max(replaySim.simulation.frames.length - 1, 0))}
              onChange={(e) => {
                setReplayPlaying(false);
                setReplayCursor(Number(e.target.value));
              }}
              className="w-full"
            />

            {replayCurrentFrame ? (
              <div className="grid gap-2 md:grid-cols-6 text-xs">
                <p className="rounded-lg bg-slate-800 p-2">Time: {new Date(replayCurrentFrame.openTime).toLocaleString()}</p>
                <p className="rounded-lg bg-slate-800 p-2">Price: {replayCurrentFrame.close}</p>
                <p className="rounded-lg bg-slate-800 p-2">Action: {replayCurrentFrame.action}</p>
                <p className="rounded-lg bg-slate-800 p-2">Prob: {replayCurrentFrame.probability}%</p>
                <p className="rounded-lg bg-slate-800 p-2">Regime: {replayCurrentFrame.regime}</p>
                <p className="rounded-lg bg-slate-800 p-2">Outcome: {replayCurrentFrame.outcomeWin === null ? "n/a" : replayCurrentFrame.outcomeWin === 1 ? "WIN" : "LOSS"}</p>
                <p className="rounded-lg bg-slate-800 p-2 md:col-span-2">Reason: {replayCurrentFrame.reason}</p>
                <p className="rounded-lg bg-slate-800 p-2">Running WR: {replayCurrentFrame.runningWinRate}%</p>
                <p className="rounded-lg bg-slate-800 p-2">Running R: {replayCurrentFrame.runningR}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
