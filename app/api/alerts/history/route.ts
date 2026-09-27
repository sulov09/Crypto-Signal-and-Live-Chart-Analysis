import { db } from "@/db";
import { alertEvents } from "@/db/schema";
import { getCurrentHandle } from "@/lib/session";
import { desc, eq, isNull, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const handle = await getCurrentHandle();

  const rows = await db
    .select()
    .from(alertEvents)
    .where(handle ? or(eq(alertEvents.userHandle, handle), isNull(alertEvents.userHandle)) : isNull(alertEvents.userHandle))
    .orderBy(desc(alertEvents.createdAt))
    .limit(30);

  return Response.json({ ok: true, alerts: rows });
}
