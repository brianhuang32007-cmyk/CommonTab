"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { FileIcon } from "@/components/app/icons";
import { signedLinks } from "@/lib/signedLinks";
import type { createClient } from "@/lib/supabase/client";
import { fileSize, type Attachment, type DraftFile, type MessagesState, type Outgoing } from "./messages";
import { personName, type Conversation, type Member } from "./types";

// The scrolling message history. Newest at the bottom; scrolling to the top loads older
// messages without moving what you're looking at.

type Item = {
  id: string;
  senderId: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
  saved: Attachment[];
  local: DraftFile[];
  outgoing?: Outgoing;
};

export default function MessageList({
  supabase,
  chat,
  me,
  state,
  outgoing,
  stickToBottom,
  onAtBottom,
  onRetry,
  onRemove,
}: {
  supabase: ReturnType<typeof createClient>;
  chat: Conversation;
  me: string;
  state: MessagesState;
  outgoing: Outgoing[];
  /** Changes whenever you send, to jump to the newest message. */
  stickToBottom: number;
  onAtBottom: (atBottom: boolean) => void;
  onRetry: (o: Outgoing) => void;
  onRemove: (o: Outgoing) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const placed = useRef(false);
  const firstSeq = useRef<number | null>(null);
  const keep = useRef<{ height: number; top: number } | null>(null);
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);

  const { status, messages, hasOlder, loadingOlder, loadOlder } = state;
  const savedIds = new Set(messages.map((m) => m.id));
  const items: Item[] = [
    ...messages.map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      mentions: m.mentions,
      createdAt: m.created_at,
      saved: m.attachments,
      local: [],
    })),
    // Sent but not saved yet (or failed). Once saved, the real message takes its place.
    ...outgoing
      .filter((o) => !savedIds.has(o.id))
      .map((o) => ({
        id: o.id,
        senderId: me,
        body: o.body,
        mentions: o.mentions,
        createdAt: o.created_at,
        saved: [],
        local: o.files,
        outgoing: o,
      })),
  ];

  // Short-lived links for saved files; renewed every few minutes while the chat is open.
  const paths = messages.flatMap((m) => m.attachments.map((a) => a.path)).join("|");
  useEffect(() => {
    const list = paths ? paths.split("|") : [];
    if (!list.length) return;
    let live = true;
    signedLinks(supabase, "chat-files", list).then((map) => live && setLinks(map));
    return () => {
      live = false;
    };
  }, [supabase, paths, tick]);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  function measure() {
    const el = box.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (bottom !== atBottom.current) {
      atBottom.current = bottom;
      onAtBottom(bottom);
    }
    if (el.scrollTop < 160 && hasOlder && !loadingOlder) {
      keep.current = { height: el.scrollHeight, top: el.scrollTop };
      loadOlder();
    }
  }

  // Keep the view steady: start at the bottom, hold your place when older messages load
  // above, and follow new messages only if you were already at the bottom.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || status !== "ready") return;
    const seq = messages[0]?.seq ?? null;
    if (!placed.current) {
      el.scrollTop = el.scrollHeight;
      placed.current = true;
    } else if (keep.current && seq !== firstSeq.current) {
      el.scrollTop = el.scrollHeight - keep.current.height + keep.current.top;
      keep.current = null;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstSeq.current = seq;
  }, [status, messages, outgoing.length]);

  useEffect(() => {
    if (!loadingOlder) keep.current = null;
  }, [loadingOlder]);

  // A short history that doesn't fill the box: load more until it scrolls (or there's no more).
  useEffect(() => {
    const el = box.current;
    if (el && status === "ready" && hasOlder && !loadingOlder && el.scrollHeight <= el.clientHeight) loadOlder();
  }, [status, hasOlder, loadingOlder, messages.length, loadOlder]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !stickToBottom) return;
    atBottom.current = true;
    onAtBottom(true);
    el.scrollTop = el.scrollHeight;
  }, [stickToBottom, onAtBottom]);

  const followImage = () => {
    if (atBottom.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  };

  const byId = new Map(chat.members.map((m) => [m.user_id, m]));
  const usernames = (ids: string[]) => new Set(ids.map((id) => byId.get(id)?.username).filter((u): u is string => Boolean(u)));
  const isGroup = chat.kind === "group";

  return (
    <div
      ref={box}
      onScroll={measure}
      role="log"
      aria-label="Messages"
      aria-busy={status === "loading" || loadingOlder}
      className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]"
    >
      <div className="flex min-h-full flex-col justify-end px-4 pt-2 pb-4 sm:px-5">
        {status === "loading" && (
          <p role="status" className="m-auto text-sm text-muted">
            Loading messages…
          </p>
        )}
        {status === "error" && (
          <div role="alert" className="m-auto max-w-xs rounded-2xl bg-mist p-4 text-center">
            <p className="text-sm font-bold">Couldn&apos;t load messages</p>
            <p className="mt-1 text-[13px] text-muted">Check your connection and try again.</p>
            <button
              type="button"
              onClick={state.retry}
              className="mt-3 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
            >
              Retry
            </button>
          </div>
        )}

        {status === "ready" && (
          <>
            {hasOlder ? (
              <p className="my-2 text-center text-xs font-semibold text-muted">{loadingOlder ? "Loading earlier messages…" : " "}</p>
            ) : (
              <Beginning chat={chat} me={me} empty={!items.length} />
            )}

            {items.map((item, i) => {
              const prev = items[i - 1];
              // A date line starts each day (the first message's day is already shown above it
              // when the conversation began that same day).
              const newDay = prev
                ? dayKey(prev.createdAt) !== dayKey(item.createdAt)
                : hasOlder || dayKey(chat.created_at) !== dayKey(item.createdAt);
              // Messages from the same person within 5 minutes sit together under one name.
              const joined =
                !newDay &&
                prev !== undefined &&
                prev.senderId === item.senderId &&
                Date.parse(item.createdAt) - Date.parse(prev.createdAt) < 5 * 60 * 1000;
              return (
                <Fragment key={item.id}>
                  {newDay && <DateLine iso={item.createdAt} />}
                  <Bubble
                    item={item}
                    mine={item.senderId === me}
                    sender={item.senderId ? byId.get(item.senderId) : undefined}
                    showName={!joined && (isGroup || item.senderId !== me)}
                    joined={joined}
                    usernames={usernames(item.mentions)}
                    links={links}
                    onImage={followImage}
                    onRetry={onRetry}
                    onRemove={onRemove}
                  />
                </Fragment>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Beginning({ chat, me, empty }: { chat: Conversation; me: string; empty: boolean }) {
  const isGroup = chat.kind === "group";
  const creator = chat.members.find((m) => m.user_id === chat.created_by);
  const who = chat.created_by === me ? "You" : (creator?.first_name ?? null);
  const text = isGroup
    ? who
      ? `${who} created the group`
      : "Group created"
    : who
      ? `${who} started this conversation`
      : "Conversation started";
  return (
    <>
      <DateLine iso={chat.created_at} />
      <Note text={text} />
      {empty && <Note text="No messages yet. Say hello!" />}
    </>
  );
}

function Note({ text }: { text: string }) {
  return <p className="mx-auto my-1 rounded-full bg-mist px-3 py-1.5 text-center text-xs font-semibold text-muted">{text}</p>;
}

function DateLine({ iso }: { iso: string }) {
  return (
    <div className="mt-3 mb-2 flex items-center gap-3 text-xs font-bold text-muted">
      <span className="h-px flex-1 bg-line" />
      {dayLabel(iso)}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Bubble({
  item,
  mine,
  sender,
  showName,
  joined,
  usernames,
  links,
  onImage,
  onRetry,
  onRemove,
}: {
  item: Item;
  mine: boolean;
  sender: Member | undefined;
  showName: boolean;
  joined: boolean;
  usernames: Set<string>;
  links: Map<string, string>;
  onImage: () => void;
  onRetry: (o: Outgoing) => void;
  onRemove: (o: Outgoing) => void;
}) {
  const name = sender ? personName(sender) : "Former member";
  const o = item.outgoing;
  const time = new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const full = new Date(item.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className={`flex gap-2.5 ${mine ? "justify-end" : "justify-start"} ${joined ? "mt-1" : "mt-3"}`}>
      {!mine && (
        <span className="w-9 shrink-0">
          {!joined && <Avatar src={sender?.avatar_url ?? null} name={name} seed={item.senderId ?? item.id} size={36} />}
        </span>
      )}
      <div className={`flex max-w-[78%] min-w-0 flex-col ${mine ? "items-end" : "items-start"}`}>
        {showName && !mine && <p className="mb-1 px-1 text-[13px] font-bold">{name}</p>}

        {(item.saved.length > 0 || item.local.length > 0) && (
          <Files saved={item.saved} local={item.local} links={links} mine={mine} onImage={onImage} />
        )}

        {item.body && (
          <p
            title={full}
            className={`rounded-2xl px-3.5 py-2 text-[15px] leading-6 break-words whitespace-pre-wrap [overflow-wrap:anywhere] ${
              mine ? "rounded-br-md bg-tint text-ink" : "rounded-bl-md border border-line bg-white text-ink"
            } ${o ? "opacity-80" : ""}`}
          >
            {/* Plain text only (no HTML), with @mentions of real members highlighted. */}
            {withMentions(item.body, usernames)}
          </p>
        )}

        <p className="mt-0.5 px-1 text-[11px] text-muted">
          {!o && (
            <time dateTime={item.createdAt} title={full}>
              {time}
            </time>
          )}
          {o?.status === "sending" && <span role="status">Sending…</span>}
        </p>
        {o?.status === "failed" && (
          <p role="alert" className="flex flex-wrap items-center justify-end gap-x-2 px-1 text-xs">
            <span className="font-semibold text-warn">Failed to send{o.error ? `: ${o.error}` : ""}</span>
            <button type="button" onClick={() => onRetry(o)} className="h-8 font-bold text-brand underline">
              Retry
            </button>
            <button type="button" onClick={() => onRemove(o)} className="h-8 font-bold text-muted underline">
              Remove
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function Files({
  saved,
  local,
  links,
  mine,
  onImage,
}: {
  saved: Attachment[];
  local: DraftFile[];
  links: Map<string, string>;
  mine: boolean;
  onImage: () => void;
}) {
  const files = [
    ...saved.map((a) => ({ key: a.id, name: a.name, type: a.mime_type, size: a.size_bytes, url: links.get(a.path) ?? null })),
    ...local.map((f) => ({ key: f.key, name: f.file.name, type: f.file.type, size: f.file.size, url: f.preview })),
  ];
  return (
    <div className={`mb-1 flex flex-wrap gap-1.5 ${mine ? "justify-end" : ""}`}>
      {files.map((f) =>
        f.type.startsWith("image/") ? (
          <a
            key={f.key}
            href={f.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${f.name}`}
            className="block overflow-hidden rounded-2xl border border-line bg-mist"
          >
            {f.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- private, short-lived link
              <img src={f.url} alt={f.name} onLoad={onImage} className="h-40 w-40 object-cover" />
            ) : (
              <span className="flex h-40 w-40 items-center justify-center text-xs text-muted">Loading…</span>
            )}
          </a>
        ) : (
          <a
            key={f.key}
            href={f.url ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-60 items-center gap-3 rounded-2xl border border-line bg-white p-3 hover:bg-mist"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
              <FileIcon className="h-5 w-5" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-bold">{f.name}</span>
              <span className="text-xs text-muted">PDF · {fileSize(f.size)}</span>
            </span>
          </a>
        ),
      )}
    </div>
  );
}

/** Splits text so each @username of someone actually mentioned is highlighted. Never HTML. */
function withMentions(body: string, usernames: Set<string>) {
  if (!usernames.size) return body;
  return body.split(/(@\w+)/g).map((part, i) =>
    part.startsWith("@") && usernames.has(part.slice(1)) ? (
      <span key={i} className="rounded bg-sage/35 px-0.5 font-bold text-brand">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}
