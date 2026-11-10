import type { createClient } from "@/lib/supabase/client";

// Which alerts and reminders you've read, one by one (supabase/migrations/20261110190000).
// Opening a reminder's destination marks it read; the task itself stays until it's done.

type Client = ReturnType<typeof createClient>;

/** The key a reminder or alert is saved under. */
export const alertKey = {
  payment: (requestId: string) => `payment:${requestId}`,
  document: (requestId: string) => `document:${requestId}`,
  contact: (userId: string) => `contact:${userId}`,
  chat: (conversationId: string) => `chat:${conversationId}`,
};

/** Mark one alert as read. Quietly does nothing if it can't be saved (it stays unread). */
export async function markAlertRead(supabase: Client, key: string) {
  await supabase.rpc("mark_notification_read", { item: key });
}

/** Your read marks: key → when you read it. */
export async function loadAlertReads(supabase: Client): Promise<Map<string, string> | null> {
  const { data, error } = await supabase.from("notification_reads").select("item_key, read_at");
  if (error) return null;
  return new Map((data ?? []).map((r: { item_key: string; read_at: string }) => [r.item_key, r.read_at]));
}

/** Unread: it arrived after "Mark all as read" and you haven't read it since it arrived. */
export function isUnreadAlert(key: string, at: string | null, seenAt: string | null, reads: Map<string, string>) {
  if (!at) return false;
  if (seenAt && Date.parse(at) <= Date.parse(seenAt)) return false;
  const readAt = reads.get(key);
  return !readAt || Date.parse(readAt) < Date.parse(at);
}
