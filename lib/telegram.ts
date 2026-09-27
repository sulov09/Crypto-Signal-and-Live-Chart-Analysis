export async function sendTelegramMessage(message: string, chatId?: string | null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_CHAT_ID;
  const finalChatId = chatId || defaultChatId;

  if (!token || !finalChatId) {
    return { ok: false, reason: "missing_telegram_config" as const };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: finalChatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    return { ok: false, reason: `telegram_http_${res.status}` as const };
  }

  const data = (await res.json()) as { ok: boolean };
  return { ok: Boolean(data.ok), reason: data.ok ? "sent" : "telegram_api_error" };
}
