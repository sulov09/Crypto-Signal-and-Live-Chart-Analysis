import { cookies } from "next/headers";

export const SESSION_COOKIE = "mvp_user_handle";

export function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

export async function getCurrentHandle() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
