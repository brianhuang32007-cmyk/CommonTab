"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ContactRow } from "@/app/(app)/contacts/types";
import type { DocumentRequestRow } from "@/app/(app)/group/documents";
import type { PaymentRequestRow } from "@/app/(app)/group/requests";
import { allAlerts, alertIsUnread, type AlertItem, type RequestEvent } from "@/lib/alerts";
import { loadAlertReads, markAlertRead as saveAlertRead } from "@/lib/notificationReads";
import { groupPictureLinks } from "@/lib/groupPictures";
import { createClient } from "@/lib/supabase/client";

// Alerts for the signed-in user, in one live source for the whole app frame: contact requests,
// unread chats, payment reminders (shares to confirm or pay, open disputes), what happened on
// your requests, and which alerts you've read. The bell (unread only), Alerts & Reminders
// (everything) and the sidebar badges all read it, so their numbers always agree.

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
  /** When you last tapped "Mark all as read" (ISO time), or null if never. */
  seenAt: string | null;
  /** Your open payment requests (the reminders come from these); null while loading. */
  paymentRows: PaymentRequestRow[] | null;
  /** Your open document requests (upload and review tasks come from these). */
  documentRows: DocumentRequestRow[];
  /** What happened on your requests lately (payments and documents, newest first). */
  events: RequestEvent[];
  /** Your read marks: alert key → when you read it. */
  reads: Map<string, string>;
  /** Reminders couldn't load the first time / a later refresh failed (what's shown stays). */
  alertsFailed: boolean;
  alertsRefreshFailed: boolean;
  /** Every alert, newest first, and the unread ones (what the bell shows). */
  alerts: AlertItem[];
  unreadAlerts: AlertItem[];
  /** How many alerts are unread (the bell's number, and Alerts & Reminders' "All"). */
  unread: number;
  /** Mark one alert read (e.g. its page opened). */
  markAlertRead: (key: string) => void;
  /** Marks everything up to now as read. False if it couldn't be saved. */
  markRead: () => Promise<boolean>;
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
  const [paymentRows, setPaymentRows] = useState<PaymentRequestRow[] | null>(null);
  const [documentRows, setDocumentRows] = useState<DocumentRequestRow[]>([]);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [reads, setReads] = useState<Map<string, string>>(new Map());
  const [alertsFailed, setAlertsFailed] = useState(false);
  const [alertsRefreshFailed, setAlertsRefreshFailed] = useState(false);
  const paymentsLoaded = useRef(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [contacts, alerts, payments, feed, documents, docFeed, marks] = await Promise.all([
      supabase.rpc("my_contacts"),
      supabase.rpc("my_message_alerts"),
      supabase.rpc("my_payment_requests"),
      supabase.rpc("my_request_events", { max_rows: 50 }),
      supabase.rpc("my_document_requests"),
      supabase.rpc("my_document_events", { max_rows: 50 }),
      loadAlertReads(supabase),
    ]);
    // Payment reminders: a failed first load shows an error; a failed refresh keeps what's shown.
    if (payments.error) {
      if (!paymentsLoaded.current) setAlertsFailed(true);
      else setAlertsRefreshFailed(true);
    } else {
      paymentsLoaded.current = true;
      setAlertsFailed(false);
      setAlertsRefreshFailed(false);
      setPaymentRows((payments.data ?? []) as PaymentRequestRow[]);
    }
    // Document requests never fail the page; what's shown stays if they can't load.
    if (!documents.error) setDocumentRows((documents.data ?? []) as DocumentRequestRow[]);
    if (!feed.error || !docFeed.error) {
      setEvents((current) => {
        const pay = feed.error ? current.filter((e) => e.source !== "document") : ((feed.data ?? []) as RequestEvent[]);
        const docs = docFeed.error ? current.filter((e) => e.source === "document") : ((docFeed.data ?? []) as RequestEvent[]);
        return [...pay, ...docs].sort((a, b) => b.created_at.localeCompare(a.created_at));
      });
    }
    if (marks) setReads(marks);
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
    // Payment shares, requests and their history change → reload. Coming back to the tab → reload.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_shares" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payment_share_events" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_requests" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_recipients" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "document_events" }, refresh)
      .subscribe();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const alerts = useMemo(
    () => allAlerts({ rows: paymentRows, docRows: documentRows, events, contacts: requests, messages }),
    [paymentRows, documentRows, events, requests, messages],
  );
  const unreadAlerts = useMemo(() => alerts.filter((a) => alertIsUnread(a, seenAt, reads)), [alerts, seenAt, reads]);
  const unread = unreadAlerts.length;

  // Shows as read right away; saved in the background.
  const markAlertRead = useCallback((key: string) => {
    setReads((r) => new Map(r).set(key, new Date().toISOString()));
    saveAlertRead(createClient(), key);
  }, []);
  const unreadMessages = messages.reduce((sum, m) => sum + m.unread_count, 0);

  const markRead = useCallback(async () => {
    const { data, error } = await createClient().rpc("mark_notifications_read");
    if (error || !data) return false;
    setSeenAt(data as string);
    return true;
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
        paymentRows,
        documentRows,
        events,
        reads,
        alertsFailed,
        alertsRefreshFailed,
        alerts,
        unreadAlerts,
        unread,
        markAlertRead,
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
