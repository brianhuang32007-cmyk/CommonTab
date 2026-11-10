"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { deadlineLabel, detailsHref } from "@/app/(app)/group/requests";
import { describeEvent, TASK, type AlertItem } from "@/lib/alerts";
import { useNow } from "@/lib/useNow";
import { BellIcon, CardIcon, CheckIcon, DocumentIcon, ReceiptIcon } from "./icons";
import { useNotifications, type MessageAlert } from "./NotificationsContext";

// Alert bell in the top bar on every page. The same alerts as Alerts & Reminders (payment
// reminders, updates on your requests, contact requests, chats), but only the UNREAD ones.
// An alert leaves the bell when you open it (its page marks it read) or tap Mark all as read.
// Opening the bell itself doesn't mark anything read. The red count is how many are unread.
export default function NotificationBell() {
  const { unreadAlerts, unread, markRead, accept, decline } = useNotifications();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [marking, setMarking] = useState<"idle" | "saving" | "failed">("idle");
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const now = useNow();

  function toggle() {
    setOpen((o) => !o);
  }

  async function markAll() {
    setMarking("saving");
    setMarking((await markRead()) ? "idle" : "failed");
  }

  // Close on a click outside, or with Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function respond(id: string, action: (id: string) => Promise<boolean>) {
    if (busy) return;
    setBusy(id);
    await action(id);
    setBusy(null);
  }

  // Unread only, newest first (the shared alerts source already sorts them).
  const items: AlertItem[] = unreadAlerts;

  const label = unread ? `Alerts, ${unread} unread` : "Alerts";

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        className={`relative flex h-12 w-12 items-center justify-center rounded-[14px] border transition lg:h-[52px] lg:w-[52px] ${
          open ? "border-brand bg-tint text-brand" : "border-line bg-white text-ink hover:bg-mist"
        }`}
      >
        <BellIcon className="h-6 w-6" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-warn px-1.5 text-xs font-bold text-white ring-2 ring-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Alerts"
          className="absolute top-full right-0 z-40 mt-2 flex h-[440px] w-[min(380px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-line bg-white shadow-xl shadow-night/15"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-5 py-3">
            <p className="text-lg font-extrabold text-ink">
              Alerts {items.length > 0 && <span className="text-sm font-bold text-muted">· {items.length} unread</span>}
            </p>
            {items.length > 0 && (
              <button
                type="button"
                onClick={markAll}
                disabled={marking === "saving"}
                className="h-9 rounded-[10px] px-2.5 text-sm font-bold text-brand hover:bg-mist disabled:opacity-60"
              >
                {marking === "saving" ? "Marking…" : marking === "failed" ? "Retry" : "Mark all as read"}
              </button>
            )}
          </div>
          {marking === "failed" && (
            <p role="alert" className="shrink-0 border-b border-line px-5 py-2 text-[13px] font-semibold text-warn">
              Couldn&apos;t mark your alerts as read. Tap Retry.
            </p>
          )}

          {/* Fixed height: the list scrolls when there are more than fit. */}
          {items.length ? (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {items.map((item) => {
                if (item.type === "chat") {
                  return <MessageItem key={item.key} alert={item.message} now={now} onOpen={() => setOpen(false)} />;
                }
                if (item.type === "task") {
                  const t = item.task;
                  const info = TASK[t.kind];
                  const due = deadlineLabel(t.due);
                  return (
                    <li key={item.key} className="border-b border-[#EEF1EA]">
                      <Link href={t.href} onClick={() => setOpen(false)} className="flex items-start gap-3 px-5 py-4 hover:bg-mist">
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
                          <span className="block text-sm text-ink">
                            <span className="font-bold">{info.status}</span> · {t.title}
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{t.detail}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {t.group} · {due.text}
                          </span>
                        </span>
                        <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
                      </Link>
                    </li>
                  );
                }
                if (item.type === "event") {
                  const e = item.event;
                  const d = describeEvent(e);
                  return (
                    <li key={item.key} className="border-b border-[#EEF1EA]">
                      <Link
                        href={detailsHref(e.conversation_id, e.request_id)}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 px-5 py-4 hover:bg-mist"
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                            d.tone === "done" ? "bg-brand text-white" : d.tone === "warn" ? "bg-butter text-honey" : "bg-tint text-brand"
                          }`}
                        >
                          {d.tone === "done" ? <CheckIcon className="h-5 w-5" /> : <CardIcon className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-ink">
                            <span className="font-bold">{d.title}</span> · {e.title}
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{d.detail}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {e.conversation_name ?? "Group"}
                            {now && ` · ${timeAgo(e.created_at, now)}`}
                          </span>
                        </span>
                        <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
                      </Link>
                    </li>
                  );
                }
                const r = item.contact;
                const name = `${r.first_name} ${r.last_name}`;
                return (
                  <li key={item.key} className="border-b border-[#EEF1EA] px-5 py-4">
                    <div className="flex items-start gap-3">
                      <Avatar src={r.avatar_url} name={name} seed={r.user_id} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">
                          <span className="font-bold">{name}</span> <span className="text-muted">@{r.username}</span> sent you a contact
                          request.
                        </p>
                        {now && <p className="mt-0.5 text-xs text-muted">{timeAgo(r.requested_at, now)}</p>}
                        <div className="mt-2.5 flex gap-2">
                          <button
                            type="button"
                            disabled={busy === r.user_id}
                            onClick={() => respond(r.user_id, accept)}
                            className="h-9 rounded-[10px] bg-brand px-4 text-sm font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busy === r.user_id}
                            onClick={() => respond(r.user_id, decline)}
                            className="h-9 rounded-[10px] border border-line bg-white px-4 text-sm font-bold text-ink transition hover:bg-mist disabled:opacity-60"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                      <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-tint text-brand">
                <BellIcon className="h-6 w-6" />
              </span>
              <p className="font-bold text-ink">You&apos;re all caught up</p>
              <p className="text-sm text-muted">Unread payment reminders, updates, messages and contact requests show up here.</p>
            </div>
          )}

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex h-12 shrink-0 items-center justify-center border-t border-line text-sm font-bold text-brand hover:bg-mist"
          >
            View All Alerts
          </Link>
        </div>
      )}
    </div>
  );
}

/** One chat with unread messages. Opens that chat. */
function MessageItem({ alert, now, onOpen }: { alert: MessageAlert; now: Date | null; onOpen: () => void }) {
  const sender = alert.sender_first_name ? `${alert.sender_first_name} ${alert.sender_last_name}` : "Former member";
  const isGroup = alert.kind === "group";
  const preview =
    alert.preview || (alert.file_count ? `Sent ${alert.file_count === 1 ? "a file" : `${alert.file_count} files`}` : "New message");
  const count = `${alert.unread_count} new ${alert.unread_count === 1 ? "message" : "messages"}`;
  return (
    <li className="border-b border-[#EEF1EA]">
      <Link href={`/group?chat=${alert.conversation_id}`} onClick={onOpen} className="flex items-start gap-3 px-5 py-4 hover:bg-mist">
        {isGroup ? (
          <Avatar
            src={alert.picture_url}
            name={alert.group_name ?? "Group"}
            seed={alert.conversation_id}
            size={40}
            shape="square"
            gradient={alert.avatar_gradient}
          />
        ) : (
          <Avatar src={alert.sender_avatar_url} name={sender} seed={alert.sender_id ?? alert.conversation_id} size={40} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">
            <span className="font-bold">{sender}</span>
            {isGroup ? (
              <>
                {" "}
                {alert.mentions_me ? "mentioned you" : "wrote"} in <span className="font-bold">{alert.group_name}</span>
              </>
            ) : alert.mentions_me ? (
              " mentioned you"
            ) : (
              " sent you a message"
            )}
          </span>
          {/* Plain text only. */}
          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{preview}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {count}
            {now && ` · ${timeAgo(alert.created_at, now)}`}
          </span>
        </span>
        <span aria-label="Unread" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
      </Link>
    </li>
  );
}

function timeAgo(iso: string, now: Date) {
  const seconds = (now.getTime() - Date.parse(iso)) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
