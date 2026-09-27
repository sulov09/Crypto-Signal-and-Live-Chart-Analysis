import { getCurrentHandle } from "@/lib/session";
import { sendTelegramMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const handle = await getCurrentHandle();
  if (!handle) {
    return Response.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { chatId?: string };
  const message = `✅ *Scalp Signal Pro*\nTelegram test successful for user: \`${handle}\``;
  const result = await sendTelegramMessage(message, body.chatId?.trim() || null);

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: `Telegram send failed: ${result.reason}`,
      },
      { status: 400 },
    );
  }

  return Response.json({ ok: true });
}
