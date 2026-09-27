import { boolean, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const signalSnapshots = pgTable("signal_snapshots", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  coinId: text("coin_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  timeframe: text("timeframe").notNull(),
  action: text("action").notNull(),
  score: integer("score").notNull(),
  probability: integer("probability").notNull(),
  entryPrice: real("entry_price").notNull(),
  stopLoss: real("stop_loss").notNull(),
  takeProfit: real("take_profit").notNull(),
  riskReward: real("risk_reward").notNull(),
  note: text("note").notNull(),
  factors: jsonb("factors").$type<Record<string, number>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userHandle: text("user_handle").notNull().unique(),
  defaultTimeframe: text("default_timeframe").notNull().default("15m"),
  watchlist: jsonb("watchlist").$type<string[]>().notNull().default([]),
  riskPerTradePct: real("risk_per_trade_pct").notNull().default(1),
  maxDailyLossPct: real("max_daily_loss_pct").notNull().default(3),
  cooldownAfterLosses: integer("cooldown_after_losses").notNull().default(2),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  telegramChatId: text("telegram_chat_id"),
  autoRefreshSeconds: integer("auto_refresh_seconds").notNull().default(60),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alertEvents = pgTable("alert_events", {
  id: serial("id").primaryKey(),
  userHandle: text("user_handle"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  action: text("action").notNull(),
  probability: integer("probability").notNull(),
  message: text("message").notNull(),
  source: text("source").notNull().default("scan"),
  telegramDelivered: boolean("telegram_delivered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const backtestReports = pgTable("backtest_reports", {
  id: serial("id").primaryKey(),
  userHandle: text("user_handle"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  lookback: integer("lookback").notNull(),
  trades: integer("trades").notNull(),
  winRate: real("win_rate").notNull(),
  netR: real("net_r").notNull(),
  maxDrawdownR: real("max_drawdown_r").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const signalEvaluations = pgTable("signal_evaluations", {
  id: serial("id").primaryKey(),
  userHandle: text("user_handle"),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  action: text("action").notNull(),
  regime: text("regime").notNull(),
  source: text("source").notNull(),
  predictedProbability: real("predicted_probability").notNull(),
  outcomeWin: integer("outcome_win").notNull(),
  pnlR: real("pnl_r").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const streamCandles = pgTable(
  "stream_candles",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    openTime: timestamp("open_time", { withTimezone: true }).notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    source: text("source").notNull().default("stream"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniq: uniqueIndex("stream_candles_symbol_tf_open_uniq").on(table.symbol, table.timeframe, table.openTime),
    symbolTfOpenIdx: index("stream_candles_symbol_tf_open_idx").on(table.symbol, table.timeframe, table.openTime),
  }),
);
