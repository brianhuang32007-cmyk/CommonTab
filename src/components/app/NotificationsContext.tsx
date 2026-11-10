"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ContactRow } from "@/app/(app)/contacts/types";
import { groupPictureLinks } from "@/lib/groupPictures";
import { createClient } from "@/lib/supabase/client";

// Alerts for the signed-in user: new contact requests and unread chat messages.
// One live source for the whole app frame: the bell and the sidebar badges all read it.

/** A chat with unread messages, from my_message_alerts(). */
export type MessageAlert = {
  conversation_id: string;
  kind: "group" | "dm";
  group_name: string | null;
  picture_path: string | null;
  /** Short-lived link to the group picture (filled in here). */
  picture_url: string | null;
  avatar_gradient: number | null;
  unread_count: number;
  mentions_me: boolean;
  message_id: string;
  preview: string;
  file_count: number;
  created_at: string;
  sender_id: string | null;
  sender_first_name: string | null;
  sender_last_name: string | null;
  sender_username: string | null;
  sender_avatar_url: string | null;
};

type Notifications = {
  /** Contact requests waiting for you, newest first. */
  requests: ContactRow[];
  /** Chats with unread messages, newest first. */
  messages: MessageAlert[];
  /** Unread messages across all your chats (the Group tab's number). */
  unreadMessages: number;
  /** When you last opened the bell (ISO time), or null if never. */
  seenAt: string | null;
  /** Alerts that arrived after seenAt (the bell's number). */
  unread: number;
  markRead: () => Promise<void>;
  accept: (userId: string) => Promise<boolean>;
  decline: (userId: string) => Promise<boolean>;
  /** Reload now (e.g. right after a chat was read). */
  refresh: () => void;
};

const NotificationsContext = createContext<Notifications | null>(null);

export function NotificationsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [requests, setRequests] = useState<ContactRow[]>([]);
  const [messages, setMessages] = useState<MessageAlert[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [contacts, alerts] = await Promise.all([supabase.rpc("my_contacts"), supabase.rpc("my_message_alerts")]);
    if (contacts.data) {
      setRequests(
        (contacts.data as ContactRow[])
          .filter((r) => r.relation === "received")
          .sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
      );
    }
    if (alerts.data) {
      const rows = alerts.data as Omit<MessageAlert, "picture_url">[];
      const links = await groupPictureLinks(
        supabase,
        rows.map((r) => r.picture_path),
      );
      setMessages(rows.map((r) => ({ ...r, picture_url: r.picture_path ? (links.get(r.picture_path) ?? null) : null })));
    }
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

    // A contact request changes, or a message arrives in one of your chats → reload.
    // (Realtime only sends rows the database lets you see.)
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const unread =
    requests.filter((r) => isNewer(r.requested_at, seenAt)).length + messages.filter((m) => isNewer(m.created_at, seenAt)).length;
  const unreadMessages = messages.reduce((sum, m) => sum + m.unread_count, 0);

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

  const refresh = useCallback(() => {
    load();
  }, [load]);

  return (
    <NotificationsContext.Provider
      value={{
        requests,
        messages,
        unreadMessages,
        seenAt,
        unread,
        markRead,
        accept: (id) => respond("accept_contact_request", id),
        decline: (id) => respond("remove_contact", id),
        refresh,
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
