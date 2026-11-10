"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ContactRow } from "@/app/(app)/contacts/types";
import { createClient } from "@/lib/supabase/client";

// Notifications for the signed-in user. For now these are only new contact requests.
// One live source for the whole app frame: the bell and the sidebar badge both read it.

type Notifications = {
  /** Contact requests waiting for you, newest first. */
  requests: ContactRow[];
  /** When you last opened the bell (ISO time), or null if never. */
  seenAt: string | null;
  /** Requests that arrived after seenAt. */
  unread: number;
  markRead: () => Promise<void>;
  accept: (userId: string) => Promise<boolean>;
  decline: (userId: string) => Promise<boolean>;
};

const NotificationsContext = createContext<Notifications | null>(null);

export function NotificationsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [requests, setRequests] = useState<ContactRow[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await createClient().rpc("my_contacts");
    if (!data) return;
    setRequests(
      (data as ContactRow[])
        .filter((r) => r.relation === "received")
        .sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
    );
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // First load right after mounting; later loads when something changes.
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    supabase
      .from("profiles")
      .select("notifications_seen_at")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setSeenAt(data.notifications_seen_at);
      });

    // Someone adds, cancels or accepts → reload (Realtime only sends rows that include you).
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 150);
      })
      .subscribe();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unread = requests.filter((r) => isNewer(r.requested_at, seenAt)).length;

  const markRead = useCallback(async () => {
    const { data, error } = await createClient().rpc("mark_notifications_read");
    if (!error && data) setSeenAt(data as string);
  }, []);

  const respond = useCallback(
    async (fn: "accept_contact_request" | "remove_contact", other: string) => {
      setRequests((list) => list.filter((r) => r.user_id !== other)); // feels instant
      const { error } = await createClient().rpc(fn, { other });
      await load();
      return !error;
    },
    [load],
  );

  return (
    <NotificationsContext.Provider
      value={{
        requests,
        seenAt,
        unread,
        markRead,
        accept: (id) => respond("accept_contact_request", id),
        decline: (id) => respond("remove_contact", id),
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

/** True when `time` is after `seenAt` (or nothing has been seen yet). */
export function isNewer(time: string, seenAt: string | null) {
  return !seenAt || Date.parse(time) > Date.parse(seenAt);
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error("useNotifications must be used inside the app frame");
  return value;
}
