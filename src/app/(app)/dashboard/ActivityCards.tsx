"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { CardIcon, CheckIcon, DocumentIcon, FileIcon, ReceiptIcon } from "@/components/app/icons";
import { useNotifications, type MessageAlert } from "@/components/app/NotificationsContext";
import { describeEvent, eventHref, TASK, type RequestEvent, type Task } from "@/lib/alerts";
import { useNow } from "@/lib/useNow";
import { deadlineLabel } from "../group/requests";

// "Recent activity" and "Needs your attention", from the same live alerts as the bell and
// Alerts & Reminders, so all three always agree.

const sender = (a: MessageAlert) => (a.sender_first_name ? `${a.sender_first_name} ${a.sender_last_name}` : "Former member");

function preview(a: MessageAlert) {
  return a.preview || (a.file_count ? `Sent ${a.file_count === 1 ? "a file" : `${a.file_count} files`}` : "New message");
}

function ago(iso: string, now: Date | null) {
  if (!now) return "";
  const s = (now.getTime() - Date.parse(iso)) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AlertRow({ a, now, mention }: { a: MessageAlert; now: Date | null; mention?: boolean }) {
  const isGroup = a.kind === "group";
  return (
    <li className="border-b border-[#EEF1EA] last:border-b-0">
      <Link href={`/group?chat=${a.conversation_id}`} className="flex items-start gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
        {isGroup ? (
          <Avatar
            src={a.picture_url}
            name={a.group_name ?? "Group"}
            seed={a.conversation_id}
            size={40}
            shape="square"
            gradient={a.avatar_gradient}
          />
        ) : (
          <Avatar src={a.sender_avatar_url} name={sender(a)} seed={a.sender_id ?? a.conversation_id} size={40} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">
            <span className="font-bold">{sender(a)}</span>
            {mention ? " mentioned you" : isGroup ? " wrote" : " sent you a message"}
            {isGroup && (
              <>
                {" "}
                in <span className="font-bold">{a.group_name}</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{preview(a)}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {a.unread_count} new {a.unread_count === 1 ? "message" : "messages"}
            {now && ` · ${ago(a.created_at, now)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** "2 days overdue" in yellow, "Due today" in amber, later dates plain (never red). */
const DUE_TONE = {
  overdue: "bg-butter text-honey",
  soon: "bg-butter-strong text-[#6B4A00]",
  later: "bg-tint text-brand",
  none: "bg-mist text-muted",
} as const;

function TaskRow({ t }: { t: Task }) {
  const info = TASK[t.kind];
  const due = deadlineLabel(t.due);
  return (
    <li className="border-b border-[#EEF1EA] last:border-b-0">
      <Link href={t.href} className="flex items-start gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${info.iconClass}`}>
          {info.icon === "document" ? <DocumentIcon className="h-5 w-5" /> : info.icon === "receipt" ? <ReceiptIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">
            <span className="font-bold">{info.status}</span> · {t.title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{t.detail}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className={`rounded-full px-2 py-0.5 font-bold ${DUE_TONE[due.tone]}`}>{due.text}</span>
            {t.group}
          </span>
        </span>
      </Link>
    </li>
  );
}

function EventRow({ e, now }: { e: RequestEvent; now: Date | null }) {
  const d = describeEvent(e);
  const doc = e.source === "document";
  return (
    <li className="border-b border-[#EEF1EA] last:border-b-0">
      <Link href={eventHref(e)} className="flex items-start gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
            d.tone === "done" ? "bg-brand text-white" : d.tone === "warn" ? "bg-butter text-honey" : "bg-tint text-brand"
          }`}
        >
          {d.tone === "done" ? <CheckIcon className="h-5 w-5" /> : doc ? <FileIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">
            <span className="font-bold">{d.title}</span> · {e.title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{d.detail}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {e.conversation_name ?? (e.conversation_kind === "dm" ? "Direct message" : "Group")}
            {now && ` · ${ago(e.created_at, now)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Recent activity: what happened on your payment and document requests, and new messages,
 *  newest first (the same updates as Alerts & Reminders). */
export function RecentActivity() {
  const { messages, events, paymentRows } = useNotifications();
  const now = useNow();
  const items = [
    ...events.map((e) => ({ key: `${e.source ?? "payment"}-${e.id}`, at: e.created_at, node: <EventRow key={`${e.source ?? "payment"}-${e.id}`} e={e} now={now} /> })),
    ...messages.map((a) => ({ key: `chat-${a.conversation_id}`, at: a.created_at, node: <AlertRow key={`chat-${a.conversation_id}`} a={a} now={now} /> })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);
  return (
    <section className="rounded-3xl border border-line bg-white px-6 py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-extrabold text-ink">Recent activity</h2>
        {items.length > 0 && (
          <Link href="/notifications" className="text-sm font-bold text-brand hover:underline">
            See all
          </Link>
        )}
      </div>
      {paymentRows === null ? (
        <ul aria-hidden="true" className="mt-3 flex flex-col gap-2 border-t border-[#EEF1EA] pt-3">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-2xl bg-mist" />
          ))}
        </ul>
      ) : items.length ? (
        <ul className="mt-3 border-t border-[#EEF1EA] pt-1">{items.map((i) => i.node)}</ul>
      ) : (
        <p className="mt-3 border-t border-[#EEF1EA] pt-4 text-sm text-muted">
          Nothing new yet. Payments, document updates and new messages from your groups will show up here.
        </p>
      )}
    </section>
  );
}

/** Needs your attention: every open task (confirm or pay a share, approve a payment, upload or
 *  review a document, an open dispute), most urgent first, plus messages that mention you. */
export function NeedsAttention() {
  const { messages, alerts, paymentRows } = useNotifications();
  const now = useNow();
  const tasks = alerts
    .flatMap((a) => (a.type === "task" ? [a.task] : []))
    .sort((a, b) => (!a.due || !b.due ? (a.due ? -1 : b.due ? 1 : 0) : a.due.localeCompare(b.due)));
  const mentions = messages.filter((m) => m.mentions_me);
  const total = tasks.length + mentions.length;
  return (
    <section className="min-w-0 flex-[1_1_300px] rounded-3xl border border-line bg-white p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-extrabold text-ink">Needs your attention</h2>
        {total > 0 && <span className="rounded-full bg-butter-strong px-2.5 py-0.5 text-xs font-bold text-[#5C4A0B]">{total}</span>}
      </div>
      {paymentRows === null ? (
        <ul aria-hidden="true" className="mt-3 flex flex-col gap-2">
          {[0, 1].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-2xl bg-mist" />
          ))}
        </ul>
      ) : total ? (
        <>
          <ul className="mt-3">
            {tasks.slice(0, 6).map((t) => (
              <TaskRow key={t.key} t={t} />
            ))}
            {mentions.slice(0, Math.max(0, 8 - Math.min(tasks.length, 6))).map((a) => (
              <AlertRow key={a.conversation_id} a={a} now={now} mention />
            ))}
          </ul>
          {total > 8 || tasks.length > 6 ? (
            <Link href="/notifications" className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-brand hover:underline">
              See all {total} in Alerts &amp; Reminders
            </Link>
          ) : null}
        </>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-tint p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
            <CheckIcon className="h-5 w-5" />
          </span>
          <p className="text-sm text-ink">
            <span className="font-bold">You&apos;re all set.</span> Shares to confirm or pay, payments to approve, documents to send or review, and
            mentions of you will show up here.
          </p>
        </div>
      )}
    </section>
  );
}
