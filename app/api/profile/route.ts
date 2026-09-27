import { db } from "@/db";
import { userPreferences, userProfiles } from "@/db/schema";
import { normalizeHandle, SESSION_COOKIE } from "@/lib/session";
import { isTimeframe } from "@/lib/timeframes";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const handle = cookieStore.get(SESSION_COOKIE)?.value;

  if (!handle) {
    return Response.json({ ok: true, profile: null });
  }

  const profile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.handle, handle) });
  if (!profile) {
    cookieStore.delete(SESSION_COOKIE);
    return Response.json({ ok: true, profile: null });
  }

  const prefs = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) });

  return Response.json({
    ok: true,
    profile: {
      handle,
      preferences: prefs ?? null,
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { handle?: string };
  const handle = normalizeHandle(body.handle ?? "");

  if (!handle) {
    return Response.json({ ok: false, error: "Valid handle is required" }, { status: 400 });
  }

  const existing = await db.query.userProfiles.findFirst({ where: eq(userProfiles.handle, handle) });
  if (!existing) {
    await db.insert(userProfiles).values({ handle });
    await db.insert(userPreferences).values({
      userHandle: handle,
      defaultTimeframe: "15m",
      watchlist: ["BTC", "ETH", "SOL"],
      riskPerTradePct: 1,
      maxDailyLossPct: 3,
      cooldownAfterLosses: 2,
      telegramEnabled: false,
      autoRefreshSeconds: 60,
    });
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, handle, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  const prefs = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) });

  return Response.json({ ok: true, profile: { handle, preferences: prefs ?? null } });
}

export async function PATCH(request: Request) {
  const cookieStore = await cookies();
  const handle = cookieStore.get(SESSION_COOKIE)?.value;
  if (!handle) {
    return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    defaultTimeframe?: string;
    watchlist?: string[];
    riskPerTradePct?: number;
    maxDailyLossPct?: number;
    cooldownAfterLosses?: number;
    telegramEnabled?: boolean;
    telegramChatId?: string;
    autoRefreshSeconds?: number;
  };

  const next = {
    defaultTimeframe: isTimeframe(body.defaultTimeframe) ? body.defaultTimeframe : "15m",
    watchlist: (body.watchlist ?? []).map((s) => s.toUpperCase().trim()).filter(Boolean).slice(0, 30),
    riskPerTradePct: Math.min(Math.max(Number(body.riskPerTradePct ?? 1), 0.2), 5),
    maxDailyLossPct: Math.min(Math.max(Number(body.maxDailyLossPct ?? 3), 0.5), 15),
    cooldownAfterLosses: Math.min(Math.max(Math.round(Number(body.cooldownAfterLosses ?? 2)), 1), 10),
    telegramEnabled: Boolean(body.telegramEnabled),
    telegramChatId: (body.telegramChatId ?? "").trim() || null,
    autoRefreshSeconds: Math.min(Math.max(Math.round(Number(body.autoRefreshSeconds ?? 60)), 15), 300),
  };

  const existing = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) });

  if (!existing) {
    await db.insert(userPreferences).values({ userHandle: handle, ...next });
  } else {
    await db
      .update(userPreferences)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(userPreferences.userHandle, handle));
  }

  const prefs = await db.query.userPreferences.findFirst({ where: eq(userPreferences.userHandle, handle) });

  return Response.json({ ok: true, preferences: prefs });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
