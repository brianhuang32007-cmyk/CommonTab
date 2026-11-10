"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useNow } from "@/lib/useNow";
import { BellIcon } from "./icons";
import { isNewer, useNotifications } from "./NotificationsContext";

// Alert bell in the top bar on every page. Opens a fixed-size drop-down of recent alerts
// (for now: new contact requests). A red count shows how many are unread.
export default function NotificationBell() {
  const { requests, seenAt, unread, markRead, accept, decline } = useNotifications();
  const [open, setOpen] = useState(false);
  // What counted as "new" when the drop-down was opened, so those stay highlighted while it's open.
  const [highlightSince, setHighlightSince] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const now = useNow();

  function toggle() {
    if (open) return setOpen(false);
    setHighlightSince(seenAt);
    setOpen(true);
    if (unread > 0) markRead();
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
    setBusy(id);
    await action(id);
    setBusy(null);
  }

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
          <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4">
            <p className="text-lg font-extrabold text-ink">Alerts</p>
            {requests.length > 0 && <span className="text-xs font-bold text-muted">{requests.length}</span>}
          </div>

          {/* Fixed height: the list scrolls when there are more than fit. */}
          {requests.length ? (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {requests.map((r) => {
                const name = `${r.first_name} ${r.last_name}`;
                const fresh = isNewer(r.requested_at, highlightSince);
                return (
                  <li key={r.user_id} className={`border-b border-[#EEF1EA] px-5 py-4 ${fresh ? "bg-tint/60" : ""}`}>
                    <div className="flex items-start gap-3">
                      <Avatar src={r.avatar_url} name={name} seed={r.user_id} size={40} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">
                          <span className="font-bold">{name}</span>{" "}
                          <span className="text-muted">@{r.username}</span> sent you a contact request.
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
                      {fresh && <span aria-label="New" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-warn" />}
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
              <p className="text-sm text-muted">New contact requests will show up here.</p>
            </div>
          )}

          <Link
            href="/contacts"
            onClick={() => setOpen(false)}
            className="flex h-12 shrink-0 items-center justify-center border-t border-line text-sm font-bold text-brand hover:bg-mist"
          >
            Go to Contacts
          </Link>
        </div>
      )}
    </div>
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
