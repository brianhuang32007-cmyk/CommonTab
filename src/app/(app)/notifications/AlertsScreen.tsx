"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CardIcon, CheckIcon, DocumentIcon, ReceiptIcon, SettingsIcon } from "@/components/app/icons";
import type { MessageAlert } from "@/components/app/NotificationsContext";
import type { ContactRow } from "@/app/(app)/contacts/types";
import { deadlineLabel, detailsHref, dollars, stamp, type PaymentRequestRow } from "@/app/(app)/group/requests";
import {
  describeEvent,
  paymentRef,
  rankSearch,
  searchGroup,
  SEARCH_GROUPS,
  shareTasks as buildShareTasks,
  TASK,
  type Category,
  type PaymentSearchRow,
  type RequestEvent,
  type Task,
} from "@/lib/alerts";
import { alertKey, isUnreadAlert } from "@/lib/notificationReads";

// Alerts & Reminders: everything that needs you, plus what's happened lately.
//   • Tabs (All / Payments / Documents) filter both sections and show their unread numbers.
//     "Unread only" shows just unread items in both sections.
//   • An item is unread until you open its destination (e.g. the payment request's page marks
//     its reminder read) or tap "Mark all as read". Reading never completes a task or changes a
//     payment or document: tasks stay in "Action needed" until they're done.
//   • Action needed (reminders): your outstanding tasks. A green dot marks ones that arrived
//     since you last marked alerts as read; read tasks stay until they're done. Payments to
//     confirm or pay (and open disputes) are live now. Documents to upload, documents to
//     review and payment proof to review have their rows and buttons ready; they fill in
//     once document requests exist (Step 12). Simulated payments need no proof review.
//   • Recent updates: contact requests and chats with new messages (the same as the bell).
// "Mark all as read" clears the bell's count; "Settings" opens the reminder preferences.
// This file is the screen only: AlertsView.tsx loads the real data into it, and the local
// demo (/demo/alerts) feeds it made-up data, so both look and behave the same.

export type Tab = "all" | "payments" | "documents";
type Sort = "due-asc" | "due-desc";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "payments", label: "Payments" },
  { id: "documents", label: "Documents" },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: "due-asc", label: "Due date · Earliest first" },
  { id: "due-desc", label: "Due date · Latest first" },
];

/** Subtle deadline colors: overdue honey on butter (never red for money), today or tomorrow soft amber, later pale green. */
const DEADLINE_TONE: Record<ReturnType<typeof deadlineLabel>["tone"], string> = {
  overdue: "bg-butter text-honey ring-1 ring-[#E0C266]",
  soon: "bg-butter-strong text-[#6B4A00]",
  later: "bg-tint text-brand",
  none: "bg-mist text-muted",
};

type Update = {
  key: string;
  readKey: string;
  category: Category;
  at: string;
  node: (fresh: boolean) => React.ReactNode;
};

/** Everything the screen shows. rows null = still loading. */
export type AlertsData = {
  rows: PaymentRequestRow[] | null;
  /** Tasks that don't come from payment shares (documents, payment proof). */
  extraTasks?: Task[];
  events: RequestEvent[];
  contacts: ContactRow[];
  messages: MessageAlert[];
  seenAt: string | null;
  reads: Map<string, string>;
  failed: boolean;
  refreshFailed: boolean;
  now: Date | null;
  /** Your payments for search (Payments tab), loaded on first use. rows null = not loaded yet. */
  search?: { rows: PaymentSearchRow[] | null; failed: boolean; load: () => void };
};

export default function AlertsScreen({
  data,
  viewKey,
  onRetry,
  onMarkAll,
  onAccept,
  onDecline,
  onOpen,
}: {
  data: AlertsData;
  /** Where your tab, filter, sort and scroll are remembered for this visit. */
  viewKey: string;
  onRetry: () => void;
  /** Marks everything as read; false if it couldn't be saved. */
  onMarkAll: () => Promise<boolean>;
  onAccept: (userId: string) => Promise<boolean>;
  onDecline: (userId: string) => Promise<boolean>;
  /** The demo opens nothing: it gets the read key and link instead. */
  onOpen?: (readKey: string, href: string) => void;
}) {
  const { rows, events, seenAt, reads, failed, refreshFailed, now } = data;
  const requests = data.contacts;
  const messages = data.messages;
  const VIEW_KEY = viewKey;
  const [tab, setTab] = useState<Tab>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [sort, setSort] = useState<Sort>("due-asc");
  const restoreScroll = useRef<number | null>(null); // where you were scrolled on your last visit
  const [busy, setBusy] = useState<string | null>(null);
  const [marking, setMarking] = useState<"idle" | "saving" | "failed">("idle");
  const [query, setQuery] = useState("");

  // Restore your tab, filter, sort and scroll from this visit.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) ?? "null") as {
          tab?: Tab;
          unreadOnly?: boolean;
          sort?: Sort;
          scroll?: number;
        } | null;
        if (saved?.tab && TABS.some((t) => t.id === saved.tab)) setTab(saved.tab);
        if (typeof saved?.unreadOnly === "boolean") setUnreadOnly(saved.unreadOnly);
        if (saved?.sort && SORTS.some((x) => x.id === saved.sort)) setSort(saved.sort);
        if (saved?.scroll) restoreScroll.current = saved.scroll;
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [VIEW_KEY]);

  // Keep your view (tab, filter, sort, scroll) for this visit, so coming back finds it as you left it.
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ tab, unreadOnly, sort, scroll: window.scrollY }));
      } catch {}
    };
    save();
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [VIEW_KEY, tab, unreadOnly, sort]);
  useEffect(() => {
    if (rows === null || restoreScroll.current === null) return;
    const y = restoreScroll.current;
    restoreScroll.current = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [rows]);

  /* ---------- Action needed ---------- */
  const shareTasks: Task[] = buildShareTasks(rows);

  const tasks = [...shareTasks, ...(rows ? (data.extraTasks ?? []) : [])];

  const isUnread = (item: { readKey: string; at: string | null }) => isUnreadAlert(item.readKey, item.at, seenAt, reads);
  const inTab = (category: Category, which: Tab) => which === "all" || category === which;

  const shownTasks = tasks
    .filter((t) => inTab(t.category, tab))
    .filter((t) => !unreadOnly || isUnread(t))
    // Earliest first: overdue, then the nearest deadline, then no due date. Latest first
    // reverses the dates. Tasks without a deadline stay last either way.
    .sort((a, b) => {
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
      readKey: alertKey.contact(r.user_id),
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
                onClick={() => respond(r.user_id, onAccept)}
                className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={busy === r.user_id}
                onClick={() => respond(r.user_id, onDecline)}
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
      readKey: alertKey.chat(m.conversation_id),
      category: "general",
      at: m.created_at,
      node: (fresh) => {
        const sender = `${m.sender_first_name ?? ""} ${m.sender_last_name ?? ""}`.trim() || "Someone";
        const where = m.kind === "group" ? (m.group_name ?? "a group") : "a direct message";
        const preview = m.preview || (m.file_count ? `Sent ${m.file_count === 1 ? "a file" : `${m.file_count} files`}` : "New message");
        return (
          <Go
            href={`/group?chat=${m.conversation_id}`}
            readKey={alertKey.chat(m.conversation_id)}
            onOpen={onOpen}
            className="block w-full rounded-2xl text-left hover:bg-mist"
          >
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
          </Go>
        );
      },
    })),
    ...events.map((e): Update => {
      const d = describeEvent(e);
      return {
        key: `event-${e.id}`,
        readKey: alertKey.payment(e.request_id),
        category: "payments",
        at: e.created_at,
        node: (fresh) => (
          <UpdateRow
            fresh={fresh}
            icon={
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  d.tone === "done" ? "bg-brand text-white" : d.tone === "warn" ? "bg-butter text-honey" : "bg-tint text-brand"
                }`}
              >
                {d.tone === "done" ? <CheckIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
              </span>
            }
            title={
              <>
                <span className="font-bold">{d.title}</span> · {e.title}
              </>
            }
            meta={`${e.conversation_name ?? (e.conversation_kind === "dm" ? "Direct message" : "Group")} · ${stamp(e.created_at)}`}
          >
            <p className="mt-0.5 text-sm text-muted">{d.detail}</p>
            <Go
              href={detailsHref(e.conversation_id, e.request_id)}
              readKey={alertKey.payment(e.request_id)}
              onOpen={onOpen}
              className="mt-1 inline-flex min-h-9 items-center text-sm font-bold text-brand hover:underline"
            >
              View request
            </Go>
          </UpdateRow>
        ),
      };
    }),
  ]
    // Newest first; each event once.
    .filter((u, i, all) => all.findIndex((x) => x.key === u.key) === i)
    .sort((a, b) => b.at.localeCompare(a.at));

  const shownUpdates = updates.filter((u) => inTab(u.category, tab)).filter((u) => !unreadOnly || isUnread(u));

  // Each tab's unread number (tasks and updates).
  const unreadIn = (which: Tab) =>
    tasks.filter((t) => inTab(t.category, which) && isUnread(t)).length +
    updates.filter((u) => inTab(u.category, which) && isUnread(u)).length;
  const totalUnread = unreadIn("all");

  // Marks everything you have now as read. Tasks and statuses don't change.
  async function markAll() {
    setMarking("saving");
    setMarking((await onMarkAll()) ? "idle" : "failed");
  }

  return (
    <div className="mx-auto w-full max-w-[880px] pb-10">
      {/* Header */}
      {/* The page title is in the top bar (the header on phones), so only the subtitle shows here. */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">Stay on top of your payments and documents.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={markAll}
            disabled={totalUnread === 0 || marking === "saving"}
            className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-50"
          >
            {marking === "saving" ? "Marking…" : "Mark all as read"}
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

      {refreshFailed && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-ink">
            <span className="font-semibold text-warn">Couldn&apos;t refresh.</span> Showing what was loaded before.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
          >
            Retry
          </button>
        </div>
      )}

      {marking === "failed" && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
          <p className="min-w-0 flex-1 text-sm font-semibold text-warn">Couldn&apos;t mark your alerts as read.</p>
          <button
            type="button"
            onClick={markAll}
            className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
          >
            Retry
          </button>
        </div>
      )}

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
              {unreadIn(t.id) > 0 && (
                <span
                  aria-label={`${unreadIn(t.id)} unread`}
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.id ? "bg-white text-brand" : "bg-tint text-brand"}`}
                >
                  {unreadIn(t.id)}
                </span>
              )}
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

      {/* Search payments (Payments tab): by ID (PR-… or CT-…), title, group or person. */}
      {tab === "payments" && data.search && <PaymentSearch search={data.search} query={query} setQuery={setQuery} onOpen={onOpen} />}

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

        {failed ? (
          <div className="py-6 text-center" role="alert">
            <p className="font-bold">Couldn&apos;t load reminders</p>
            <p className="mt-0.5 text-sm text-muted">Check your connection and try again.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-hover"
            >
              Retry
            </button>
          </div>
        ) : rows === null ? (
          <ul className="mt-3 flex flex-col gap-2" aria-label="Loading reminders" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-3 sm:px-4">
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-mist" />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="h-3.5 w-2/5 animate-pulse rounded-full bg-mist" />
                  <span className="h-3 w-3/5 animate-pulse rounded-full bg-mist" />
                </span>
                <span className="hidden h-11 w-28 animate-pulse rounded-xl bg-mist sm:block" />
              </li>
            ))}
          </ul>
        ) : shownTasks.length === 0 ? (
          <p className="py-6 text-center text-sm font-bold text-ink">{unreadOnly ? "No unread notifications." : "You're all caught up."}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {shownTasks.map((t) => {
              const due = deadlineLabel(t.due);
              const info = TASK[t.kind];
              const fresh = isUnread(t);
              return (
                <li
                  key={t.key}
                  className={`flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-3 sm:px-4 ${fresh ? "border-sage bg-[#FBFDF9]" : "border-line"}`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${info.iconClass}`}>
                    {info.icon === "document" ? (
                      <DocumentIcon className="h-5 w-5" />
                    ) : info.icon === "receipt" ? (
                      <ReceiptIcon className="h-5 w-5" />
                    ) : (
                      <CardIcon className="h-5 w-5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-bold">{t.title}</span>
                      {fresh && <span aria-label="Unread" className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />}
                    </span>
                    <span className="block truncate text-[13px] font-semibold text-[#3E4A43]">{t.group}</span>
                    <span className="block truncate text-sm text-muted">{t.detail}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${t.kind === "dispute" ? "bg-butter text-honey" : "bg-tint text-brand"}`}
                      >
                        {info.status}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${DEADLINE_TONE[due.tone]}`}>{due.text}</span>
                    </span>
                  </span>
                  <Go
                    href={t.href}
                    readKey={t.readKey}
                    onOpen={onOpen}
                    className="flex h-11 shrink-0 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
                  >
                    {info.button}
                  </Go>
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
        {failed ? (
          <p className="py-6 text-center text-sm text-muted">Updates will show once reminders load.</p>
        ) : rows === null ? (
          <p role="status" className="py-6 text-center text-sm text-muted">
            Loading…
          </p>
        ) : shownUpdates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {unreadOnly ? "No unread notifications." : "Recent activity will appear here."}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {shownUpdates.map((u) => (
              <li key={u.key} className="border-b border-[#EEF1EA] last:border-b-0">
                {u.node(isUnread(u))}
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
      {fresh && <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />}
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

/** A link, or (in the demo) a button that reports where it would go. */
function Go({
  href,
  readKey,
  onOpen,
  className,
  children,
}: {
  href: string;
  readKey: string;
  onOpen?: (readKey: string, href: string) => void;
  className: string;
  children: React.ReactNode;
}) {
  if (onOpen) {
    return (
      <button type="button" onClick={() => onOpen(readKey, href)} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Payment search: results grouped in order (pending confirmation, paid, confirmed but not
 *  paid yet, then disputed and waived), soonest due first within each group. */
function PaymentSearch({
  search,
  query,
  setQuery,
  onOpen,
}: {
  search: NonNullable<AlertsData["search"]>;
  query: string;
  setQuery: (q: string) => void;
  onOpen?: (readKey: string, href: string) => void;
}) {
  const { rows, failed, load } = search;
  // Load your payments the first time the search is shown.
  useEffect(() => {
    if (rows === null && !failed) load();
  }, [rows, failed, load]);

  const results = rows && query.trim() ? rankSearch(rows, query) : [];
  const groups = SEARCH_GROUPS.map((g) => ({ name: g, items: results.filter((r) => searchGroup(r) === g) })).filter((g) => g.items.length);

  return (
    <section className="mt-5 rounded-3xl border border-line bg-white p-5 sm:p-6" aria-labelledby="payment-search">
      <h3 id="payment-search" className="text-lg font-extrabold">
        Search payments
      </h3>
      <label htmlFor="payment-search-box" className="sr-only">
        Search by payment ID, title, group or person
      </label>
      <input
        id="payment-search-box"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Payment ID (PR-… or CT-…), title, group or person"
        className="mt-3 h-12 w-full rounded-xl border border-line bg-white px-4 text-base outline-none focus:border-brand"
      />
      {failed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="flex-1 text-sm text-ink">Couldn&apos;t load your payments.</p>
          <button type="button" onClick={load} className="h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
            Retry
          </button>
        </div>
      ) : !query.trim() ? (
        <p className="mt-2 text-[13px] text-muted">
          Results are ranked: pending confirmation, paid, then confirmed but not paid yet. Includes fully paid requests.
        </p>
      ) : rows === null ? (
        <p role="status" className="mt-3 text-sm text-muted">
          Loading your payments…
        </p>
      ) : results.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No payments match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <p className="text-[13px] text-muted" aria-live="polite">
            {results.length} {results.length === 1 ? "payment" : "payments"}
          </p>
          {groups.map((g) => (
            <div key={g.name}>
              <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
                {g.name} · {g.items.length}
              </p>
              <ul className="mt-1.5 flex flex-col gap-2">
                {g.items.map((r) => {
                  const due = deadlineLabel(r.due_date);
                  const mine =
                    r.direction === "received" ? `You owe ${dollars(r.my_share_cents ?? 0)}` : `You requested ${dollars(r.total_cents)}`;
                  const code = (r.codes ?? []).find((c) => c.toLowerCase().includes(query.trim().toLowerCase()));
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3 py-3 sm:px-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
                        {g.name === "Paid" ? <CheckIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate font-bold">{r.title}</span>
                          <span className="font-mono text-[12px] font-bold text-muted">{paymentRef(r.id)}</span>
                        </span>
                        <span className="block truncate text-[13px] font-semibold text-[#3E4A43]">
                          {r.conversation_name ?? (r.conversation_kind === "dm" ? "Direct message" : "Group")}
                        </span>
                        <span className="block truncate text-sm text-muted">
                          {mine}
                          {r.direction === "received" && r.requester_first_name ? ` · Requested by ${r.requester_first_name}` : ""}
                          {code ? ` · Payment ${code}` : ""}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              g.name === "Paid"
                                ? "bg-brand text-white"
                                : g.name === "Disputed"
                                  ? "bg-butter text-honey"
                                  : g.name === "Waived"
                                    ? "bg-mist text-muted"
                                    : "bg-tint text-brand"
                            }`}
                          >
                            {g.name}
                          </span>
                          {g.name !== "Paid" && g.name !== "Waived" && (
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${DEADLINE_TONE[due.tone]}`}>{due.text}</span>
                          )}
                        </span>
                      </span>
                      <Go
                        href={detailsHref(r.conversation_id, r.id)}
                        readKey={alertKey.payment(r.id)}
                        onOpen={onOpen}
                        className="flex h-11 shrink-0 items-center rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
                      >
                        View request
                      </Go>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
