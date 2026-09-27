export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function sma(values: number[], period: number) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

export function ema(values: number[], period: number) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let out = values[0];
  for (let i = 1; i < values.length; i++) {
    out = values[i] * k + out * (1 - k);
  }
  return out;
}

export function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[]) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  if (fast === null || slow === null) return null;
  const line = fast - slow;

  const macdSeries: number[] = [];
  for (let i = 26; i < values.length; i++) {
    const slice = values.slice(0, i + 1);
    const f = ema(slice, 12);
    const s = ema(slice, 26);
    if (f !== null && s !== null) macdSeries.push(f - s);
  }

  const signal = ema(macdSeries, 9);
  if (signal === null) return null;
  const hist = line - signal;
  return { line, signal, hist };
}

export function atrFromCandles(highs: number[], lows: number[], closes: number[], period = 14) {
  if (highs.length !== lows.length || lows.length !== closes.length || closes.length < period + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const recent = tr.slice(-period);
  return recent.reduce((s, v) => s + v, 0) / period;
}

export function stdDev(values: number[]) {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function normalize(value: number, min: number, max: number) {
  if (max === min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}
