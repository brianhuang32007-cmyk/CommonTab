"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { CardIcon, DocumentIcon, SettingsIcon } from "@/components/app/icons";
import { isNewer, useNotifications } from "@/components/app/NotificationsContext";
import { detailsHref, dollars, dueLabel, settleHref, type PaymentRequestRow } from "@/app/(app)/group/requests";
import { createClient } from "@/lib/supabase/client";

// Alerts & Reminders: everything that needs you, plus what's happened lately.
//   • Tabs (All / Payments / Documents) filter both sections; "Unread only" hides updates
//     you've already seen (tasks stay until they're done).
//   • Action needed: payment shares you still have to confirm or pay, and open disputes.
//     Documents join when document requests are built (Step 12).
//   • Recent updates: contact requests and chats with new messages (the same as the bell).
// "Mark all as read" clears the bell's count; "Settings" opens the reminder preferences.

type Tab = "all" | "payments" | "documents";
type Category = "payments" | "documents" | "general";
type Sort = "due-asc" | "due-desc" | "amount-desc";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payments", label: "Payments" },
  { id: "documents", label: "Documents" },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: "due-asc", label: "Due date · Earliest first" },
  { id: "due-desc", label: "Due date · Latest first" },
  { id: "amount-desc", label: "Amount · Highest first" },
];

type Task = {
  key: string;
  category: Category;
  title: string;
  detail: string;
  due: string | null;
  cents: number;
  action: { label: string; href: string };
  tone: "confirm" | "pay" | "dispute";
};

type Update = {
  key: string;
  category: Category;
  at: string;
  node: (fresh: boolean) => React.ReactNode;
};

export default function AlertsView() {
  const { requests, messages, seenAt, unread, markRead, accept, decline } = useNotifications();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("due-asc");
  const [rows, setRows] = useState<PaymentRequestRow[] | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Your open payment requests, kept live as shares change.
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_payment_requests");
    if (!error) setRows((data ?? []) as PaymentRequestRow[]);
  }, [supabase]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      load();
      setNow(new Date());
    }, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    };
    const channel = supabase
      .channel("alerts-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_shares" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, load]);

  /* ---------- Action needed ---------- */
  const tasks: Task[] = (rows ?? []).flatMap((r): Task[] => {
    if (r.direction !== "received" || r.my_share_cents === null) return [];
    const where = r.conversation_name ?? "a chat";
    const base = { category: "payments" as const, due: r.due_date, cents: r.my_share_cents, title: r.title };
    if (r.my_share_status === "pending") {
      return [
        {
          ...base,
          key: `c-${r.id}`,
          detail: `Confirm your share of ${dollars(r.my_share_cents)} · ${where}`,
          action: { label: "Confirm", href: detailsHref(r.conversation_id, r.id) },
          tone: "confirm",
        },
      ];
    }
    if (r.my_share_status === "confirmed") {
      return [
        {
          ...base,
          key: `p-${r.id}`,
          detail: `Pay your share of ${dollars(r.my_share_cents)} · ${where}`,
          action: { label: "Settle", href: settleHref(r.conversation_id, r.id) },
          tone: "pay",
        },
      ];
    }
    if (r.my_share_status === "disputed") {
      return [
        {
          ...base,
          key: `d-${r.id}`,
          detail: `Your dispute on ${dollars(r.my_share_cents)} is open · ${where}`,
          action: { label: "View Dispute", href: detailsHref(r.conversation_id, r.id) },
          tone: "dispute",
        },
      ];
    }
    return [];
  });

  const shownTasks = tasks
    .filter((t) => tab === "all" || t.category === tab)
    .sort((a, b) => {
      if (sort === "amount-desc") return b.cents - a.cents;
      // No due date always goes last.
      if (!a.due || !b.due) return a.due ? -1 : b.due ? 1 : 0;
      return sort === "due-asc" ? a.due.localeCompare(b.due) : b.due.localeCompare(a.due);
    });

  /* ---------- Recent updates ---------- */
  async function respond(id: string, fn: (id: string) => Promise<boolean>) {
    setBusy(id);
    await fn(id);
    setBusy(null);
  }

  const updates: Update[] = [
    ...requests.map((r): Update => ({
      key: `contact-${r.user_id}`,
      category: "general",
      at: r.requested_at,
      node: (fresh) => {
        const name = `${r.first_name} ${r.last_name}`.trim() || `@${r.username}`;
        return (
          <UpdateRow
            fresh={fresh}
            icon={<Avatar src={r.avatar_url} name={name} seed={r.user_id} size={40} />}
            title={
              <>
                <span className="font-bold">{name}</span> wants to add you as a contact
              </>
            }
            meta={now ? `Contacts · ${timeAgo(r.requested_at, now)}` : "Contacts"}
          >
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy === r.user_id}
                onClick={() => respond(r.user_id, accept)}
                className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy === r.user_id}
                onClick={() => respond(r.user_id, decline)}
                className="h-10 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-mist disabled:opacity-60"
              >
                Decline
              </button>
            </div>
          </UpdateRow>
        );
      },
    })),
    ...messages.map((m): Update => ({
      key: `chat-${m.conversation_id}`,
      category: "general",
      at: m.created_at,
      node: (fresh) => {
        const sender = `${m.sender_first_name ?? ""} ${m.sender_last_name ?? ""}`.trim() || "Someone";
        const where = m.kind === "group" ? (m.group_name ?? "a group") : "a direct message";
        const preview = m.preview || (m.file_count ? `Sent ${m.file_count === 1 ? "a file" : `${m.file_count} files`}` : "New message");
        return (
          <Link href={`/group?chat=${m.conversation_id}`} className="block rounded-2xl hover:bg-mist">
            <UpdateRow
              fresh={fresh}
              icon={<Avatar src={m.sender_avatar_url} name={sender} seed={m.sender_id ?? m.conversation_id} size={40} />}
              title={
                <>
                  <span className="font-bold">{sender}</span>
                  {m.mentions_me ? " mentioned you" : ` sent ${m.unread_count > 1 ? `${m.unread_count} messages` : "a message"}`} in{" "}
                  <span className="font-bold">{where}</span>
                </>
              }
              meta={now ? `Group · ${timeAgo(m.created_at, now)}` : "Group"}
            >
              <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
            </UpdateRow>
          </Link>
        );
      },
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const shownUpdates = updates.filter((u) => tab === "all" || u.category === tab).filter((u) => !unreadOnly || isNewer(u.at, seenAt));

  const emptyWhat = tab === "payments" ? "payment " : tab === "documents" ? "document " : "";

  return (
    <div className="mx-auto w-full max-w-[880px] pb-10">
      {/* Header */}
      {/* The page title is in the top bar (the header on phones), so only the subtitle shows here. */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">Stay on top of your payments and documents.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => markRead()}
            disabled={unread === 0}
            className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-50"
          >
            Mark all as read
          </button>
          <Link
            href="/preferences#reminders"
            className="flex h-11 items-center gap-1.5 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
          >
            <SettingsIcon className="h-4 w-4" />
            Settings
          </Link>
        </div>
      </div>

      {/* Tabs and the Unread only switch */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter alerts" className="flex gap-1 rounded-2xl border border-line bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`h-10 rounded-xl px-4 text-sm font-bold ${tab === t.id ? "bg-brand text-white" : "text-muted hover:bg-mist hover:text-ink"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-bold text-ink">
          Unread only
          <input
            type="checkbox"
            role="switch"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-7 w-12 rounded-full bg-line transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
          />
        </label>
      </div>

      {/* Action needed */}
      <section className="mt-5 rounded-3xl border border-line bg-white p-5 sm:p-6" aria-labelledby="action-needed">
        <div className="flex flex-wrap items-center gap-3">
          <h3 id="action-needed" className="flex items-center gap-2 text-lg font-extrabold">
            Action needed
            <span
              className="rounded-full bg-butter-strong px-2.5 py-0.5 text-xs font-bold text-[#5C4A0B]"
              aria-label={`${shownTasks.length} tasks`}
            >
              {shownTasks.length}
            </span>
          </h3>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="sr-only">Sort tasks</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="h-11 rounded-xl border border-line bg-white px-3 text-sm font-bold text-ink outline-none focus:border-brand"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rows === null ? (
          <p role="status" className="py-6 text-center text-sm text-muted">
            Loading…
          </p>
        ) : shownTasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {tab === "documents" ? "Document requests are coming soon." : `You're all caught up. No ${emptyWhat}tasks right now.`}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {shownTasks.map((t) => {
              const due = dueLabel(t.due);
              return (
                <li key={t.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3 py-3 sm:px-4">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      t.tone === "dispute" ? "bg-butter text-honey" : t.tone === "pay" ? "bg-tint text-brand" : "bg-citron text-brand"
                    }`}
                  >
                    {t.category === "documents" ? <DocumentIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{t.title}</span>
                    <span className="block truncate text-sm text-muted">{t.detail}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${due.overdue ? "bg-butter text-honey" : "bg-mist text-muted"}`}
                  >
                    {due.text}
                  </span>
                  <Link
                    href={t.action.href}
                    className="flex h-11 shrink-0 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
                  >
                    {t.action.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent updates */}
      <section className="mt-5 rounded-3xl border border-line bg-white p-5 sm:p-6" aria-labelledby="recent-updates">
        <h3 id="recent-updates" className="text-lg font-extrabold">
          Recent updates
        </h3>
        {shownUpdates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {unreadOnly ? `No unread ${emptyWhat}updates.` : `No ${emptyWhat}updates yet.`}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {shownUpdates.map((u) => (
              <li key={u.key} className="border-b border-[#EEF1EA] last:border-b-0">
                {u.node(isNewer(u.at, seenAt))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UpdateRow({
  fresh,
  icon,
  title,
  meta,
  children,
}: {
  fresh: boolean;
  icon: React.ReactNode;
  title: React.ReactNode;
  meta: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-2 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{title}</p>
        {children}
        <p className="mt-1 text-xs text-muted">{meta}</p>
      </div>
      {fresh && <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warn" />}
    </div>
  );
}

function timeAgo(iso: string, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
