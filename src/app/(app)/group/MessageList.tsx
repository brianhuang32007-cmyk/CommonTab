"use client";

import Link from "next/link";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CardIcon, CheckIcon, CloseIcon, FileIcon, ReceiptIcon, UploadIcon } from "@/components/app/icons";
import { paymentRef } from "@/lib/alerts";
import { signedLinks } from "@/lib/signedLinks";
import type { createClient } from "@/lib/supabase/client";
import { docRef, docTypeLabel, documentHref, type DocumentRequestView } from "./documents";
import { fileSize, type Attachment, type DraftFile, type MessagesState, type Outgoing } from "./messages";
import { detailsHref, dollars, dueLabel, settleHref, SHARE_STATUS, type PaymentRequestView } from "./requests";
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
  /** A payment request's card (shown instead of the text). */
  request?: PaymentRequestView | null;
  /** A document request's card (shown instead of the text). */
  document?: DocumentRequestView | null;
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
      request: m.payment_request ?? null,
      document: m.document_request ?? null,
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
                    me={me}
                    members={byId}
                    supabase={supabase}
                    onDrop={state.drop}
                    onRequestChanged={state.refreshRequest}
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
  me,
  members,
  supabase,
  onDrop,
  onRequestChanged,
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
  me: string;
  members: Map<string, Member>;
  supabase: ReturnType<typeof createClient>;
  onDrop: (messageId: string) => void;
  onRequestChanged: (requestId: string) => void;
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

        {item.request && (
          <RequestCard
            request={item.request}
            me={me}
            members={members}
            supabase={supabase}
            onDeleted={() => onDrop(item.id)}
            onChanged={() => onRequestChanged(item.request!.id)}
          />
        )}

        {item.document && <DocumentCard request={item.document} me={me} members={members} />}

        {item.body && !item.request && !item.document && (
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

/** A payment request in the chat. Everyone sees the total, the due date, who asked, the
 *  progress bar and who has paid; the chip and "your" line say where you stand. */
function RequestCard({
  request,
  me,
  members,
  supabase,
  onDeleted,
  onChanged,
}: {
  request: PaymentRequestView;
  me: string;
  members: Map<string, Member>;
  supabase: ReturnType<typeof createClient>;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  // The group owner or whoever made the request can delete it (the database checks too).
  const canDelete = request.created_by === me || members.get(me)?.role === "owner";
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setProblem(null);
    const { error } = await supabase.rpc("delete_payment_request", { req: request.id });
    if (error) {
      setProblem(error.message);
      setDeleting(false);
      return;
    }
    onDeleted();
  }
  const due = dueLabel(request.due_date);
  const iAmPayee = request.payee_id === me;
  const inSplit = request.my_share_cents !== null && !iAmPayee;
  // Tagged to pay: they can settle. The sender and everyone else see Details only.
  // People paying confirm their share first; only then can they settle it.
  const myStatus = request.my_share_status;
  const action: "confirm" | "settle" | "dispute" | null = !inSplit
    ? null
    : myStatus === "pending"
      ? "confirm"
      : myStatus === "confirmed"
        ? "settle"
        : myStatus === "disputed"
          ? "dispute"
          : null;
  const canSettle = action !== null;
  const [confirmingShare, setConfirmingShare] = useState(false);
  const [shareProblem, setShareProblem] = useState<string | null>(null);
  async function confirmShare() {
    setConfirmingShare(true);
    setShareProblem(null);
    const { error } = await supabase.rpc("confirm_payment_share", { req: request.id });
    setConfirmingShare(false);
    if (error) setShareProblem(error.message);
    else onChanged();
  }
  const firstName = (id: string | null) =>
    id === me ? "you" : id ? (members.get(id)?.first_name ?? "a former member") : "a former member";

  // Progress counts everyone in the split. A requester who included themselves is already
  // settled, so it starts at "1 of N settled" with them under Paid.
  const payers = (request.shares ?? []).filter((s) => s.status !== "waived"); // canceled in a dispute
  const paid = payers.filter((s) => s.status === "settled");
  const waiting = payers.filter((s) => s.status !== "settled");
  const percent = payers.length ? Math.round((paid.length / payers.length) * 100) : 0;
  const names = (list: typeof payers) =>
    list.map((s) => (s.user_id === me ? "You" : (members.get(s.user_id)?.first_name ?? "Former member"))).join(", ");

  const chip = iAmPayee
    ? { text: "You requested", className: "bg-white text-brand" }
    : inSplit
      ? { text: "You're paying", className: "bg-butter-strong text-[#5C4A0B]" }
      : { text: "Not in this request", className: "bg-white text-muted" };

  return (
    <div className="w-[min(340px,100%)] overflow-hidden rounded-2xl border border-line bg-white text-left">
      <div className="flex items-center gap-2 bg-tint px-4 py-2.5">
        <CardIcon className="h-[18px] w-[18px] text-ink" />
        <p className="flex-1 text-[11px] font-bold tracking-[0.14em] text-ink uppercase">Payment request</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chip.className}`}>{chip.text}</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label="Delete this request"
            title="Delete this request"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-white/70"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-4 pt-3">
        <p className="text-lg leading-6 font-extrabold break-words">{request.title}</p>
        <p className="font-mono text-[11px] font-bold text-muted">{paymentRef(request.id)}</p>
        <p className="mt-0.5 flex items-center gap-2 font-extrabold">
          {dollars(request.total_cents)} total
          {request.status === "settled" && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">Fully paid</span>
          )}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">
          <span className={due.overdue ? "rounded-full bg-butter px-1.5 py-0.5 font-bold text-honey" : ""}>{due.text}</span> · Requested by{" "}
          {iAmPayee ? "you" : firstName(request.created_by)}
        </p>
        {request.has_receipt && (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-xs font-bold text-brand">
            <ReceiptIcon className="h-3.5 w-3.5" />
            Digital receipt available
          </span>
        )}
      </div>

      <div className="mx-4 mt-3 border-t border-line pt-3">
        {iAmPayee ? (
          <p className="flex items-baseline justify-between font-bold">
            You&apos;re still owed{" "}
            <span className="text-lg font-extrabold text-brand">
              {dollars(
                Math.max(
                  0,
                  waiting.reduce((a, s) => a + s.amount_cents, 0),
                ),
              )}
            </span>
          </p>
        ) : inSplit ? (
          <p className="flex items-baseline justify-between gap-2 font-bold">
            <span className="flex items-center gap-2">
              Your share
              {myStatus && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${SHARE_STATUS[myStatus].className}`}>
                  {SHARE_STATUS[myStatus].label}
                </span>
              )}
            </span>
            <span className="text-lg font-extrabold text-ink">
              {request.my_share_status === "settled"
                ? "Paid"
                : request.my_share_status === "waived"
                  ? "Waived"
                  : dollars(request.my_share_cents ?? 0)}
            </span>
          </p>
        ) : (
          <p className="flex items-baseline justify-between text-muted">
            You&apos;re not in this request <span className="font-bold">$0.00</span>
          </p>
        )}

        {payers.length > 0 && (
          <>
            <div
              className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-mist"
              role="progressbar"
              aria-label="Settled so far"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-leaf" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1.5 text-[13px] text-muted">
              {paid.length} of {payers.length} settled
            </p>
            {iAmPayee ? (
              <ul className="mt-2 flex flex-col gap-1" aria-label="Where each person stands">
                {payers.map((s) => {
                  const st = s.status ? SHARE_STATUS[s.status] : null;
                  return (
                    <li key={s.user_id} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate text-ink">{names([s])}</span>
                      <span className="shrink-0 text-muted">{dollars(s.amount_cents)}</span>
                      {st && (
                        <span className={`w-[84px] shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-bold ${st.className}`}>
                          {st.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-ink">
                  <span className="font-bold text-brand">Paid:</span> {paid.length ? names(paid) : "no one yet"}
                </p>
                {waiting.length > 0 && (
                  <p className="text-[13px] text-ink">
                    <span className="font-bold">Not paid yet:</span> {names(waiting)}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className={`grid gap-2 px-4 pt-3 pb-4 ${canSettle ? "grid-cols-2" : "grid-cols-1"}`}>
        <Link
          href={detailsHref(request.conversation_id, request.id)}
          className={`flex h-11 items-center justify-center rounded-xl text-sm font-bold ${
            canSettle ? "border border-line bg-white text-ink hover:bg-mist" : "bg-brand text-white hover:bg-brand-hover"
          }`}
        >
          Details
        </Link>
        {action === "confirm" && (
          <button
            type="button"
            onClick={confirmShare}
            disabled={confirmingShare}
            className="flex h-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {confirmingShare ? "Confirming…" : "Confirm"}
          </button>
        )}
        {action === "settle" && (
          <Link
            href={settleHref(request.conversation_id, request.id)}
            className="flex h-11 items-center justify-center rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-hover"
          >
            Settle
          </Link>
        )}
        {action === "dispute" && (
          <Link
            href={detailsHref(request.conversation_id, request.id)}
            className="flex h-11 items-center justify-center rounded-xl bg-butter text-sm font-bold text-honey hover:bg-butter-strong"
          >
            In Dispute
          </Link>
        )}
        {action === "confirm" && !shareProblem && (
          <p className="col-span-2 text-center text-[12px] text-muted">Confirm your share before paying.</p>
        )}
        {shareProblem && (
          <p role="alert" className="col-span-2 text-[13px] font-semibold text-warn">
            {shareProblem}
          </p>
        )}
      </div>

      {canDelete &&
        (confirming ? (
          <div role="alertdialog" aria-label="Delete this request?" className="mx-4 mb-4 rounded-xl bg-butter p-3">
            <p className="text-sm font-bold text-honey">Delete this request for everyone?</p>
            <p className="mt-0.5 text-[13px] text-ink">The card and its shares are removed. This can&apos;t be undone.</p>
            {problem && <p className="mt-1 text-[13px] font-semibold text-warn">{problem}</p>}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                autoFocus
                disabled={deleting}
                onClick={remove}
                className="flex h-10 items-center gap-2 rounded-lg bg-ink px-3.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirming(false)}
                className="h-10 rounded-lg border border-line bg-white px-3.5 text-sm font-bold hover:bg-white/60 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null)}
    </div>
  );
}

/** "Alex", "Alex and Sam", "Alex, Sam and Jordan". */
function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A document request in the chat: who is asking whom for what, and your next step.
 *  People asked: an Upload Document box (or where their upload stands). The requester: progress
 *  and a Review box when something is waiting. Everyone: View Details. */
function DocumentCard({ request, me, members }: { request: DocumentRequestView; me: string; members: Map<string, Member> }) {
  const iAsked = request.created_by === me;
  const mine = request.my_status;
  const href = documentHref(request.conversation_id, request.id);
  const due = dueLabel(request.due_date);
  const open = request.status === "open";
  const first = (id: string | null) => (id ? (members.get(id)?.first_name ?? "A former member") : "A former member");
  const asked = request.recipients.filter((r) => r.user_id !== me).map((r) => first(r.user_id));
  const percent = request.recipient_count ? Math.round((request.accepted_count / request.recipient_count) * 100) : 0;

  const label = iAsked ? (
    <>
      You&apos;re requesting <span className="font-bold">{request.title}</span> from {joinNames(asked)}
    </>
  ) : (
    <>
      {first(request.created_by)} is requesting <span className="font-bold">{request.title}</span> from{" "}
      {mine ? (asked.length ? `you and ${joinNames(asked)}` : "you") : joinNames(asked)}
    </>
  );

  const chip = iAsked
    ? { text: "You requested", className: "bg-white text-brand" }
    : mine
      ? { text: "You're asked", className: "bg-butter-strong text-[#5C4A0B]" }
      : { text: "Not in this request", className: "bg-white text-muted" };

  // Your box: what to do next, or where your upload stands.
  const box = (() => {
    if (!open) return null;
    if (iAsked) {
      if (!request.waiting_count) return null;
      return (
        <Link href={href} className="flex min-h-12 items-center gap-2.5 rounded-xl bg-butter-strong px-3.5 py-2.5 font-bold text-[#5C4A0B] hover:bg-butter">
          <FileIcon className="h-5 w-5 shrink-0" />
          Review {request.waiting_count === 1 ? "1 document" : `${request.waiting_count} documents`}
        </Link>
      );
    }
    switch (mine) {
      case "requested":
        return (
          <Link
            href={`${href}#upload`}
            className="flex min-h-12 items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-brand/40 bg-tint px-3.5 py-2.5 font-bold text-brand hover:border-brand"
          >
            <UploadIcon className="h-5 w-5 shrink-0" />
            Upload Document
          </Link>
        );
      case "submitted":
        return (
          <p className="flex min-h-12 items-center gap-2.5 rounded-xl bg-mist px-3.5 py-2.5 text-sm font-bold text-ink">
            <FileIcon className="h-5 w-5 shrink-0 text-muted" />
            Waiting for review
          </p>
        );
      case "accepted":
        return (
          <p className="flex min-h-12 items-center gap-2.5 rounded-xl bg-tint px-3.5 py-2.5 text-sm font-bold text-brand">
            <CheckIcon className="h-5 w-5 shrink-0" />
            Accepted
          </p>
        );
      case "rejected":
        return (
          <Link href={`${href}#upload`} className="flex min-h-12 items-center gap-2.5 rounded-xl bg-butter px-3.5 py-2.5 text-sm font-bold text-honey hover:bg-butter-strong">
            <UploadIcon className="h-5 w-5 shrink-0" />
            Rejected: Upload Again
          </Link>
        );
      case "cant_provide":
        return <p className="rounded-xl bg-mist px-3.5 py-2.5 text-sm font-bold text-muted">You said you can&apos;t provide it</p>;
      default:
        return null;
    }
  })();

  return (
    <div className="w-[min(340px,100%)] overflow-hidden rounded-2xl border border-line bg-white text-left">
      <div className="flex items-center gap-2 bg-tint px-4 py-2.5">
        <FileIcon className="h-[18px] w-[18px] text-ink" />
        <p className="flex-1 text-[11px] font-bold tracking-[0.14em] text-ink uppercase">Document request</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${chip.className}`}>{chip.text}</span>
      </div>

      <div className="px-4 pt-3">
        <p className="flex flex-wrap items-center gap-2 text-lg leading-6 font-extrabold break-words">
          {request.title}
          {request.status === "complete" && <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">Complete</span>}
          {request.status === "cancelled" && <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-bold text-muted">Canceled</span>}
        </p>
        <p className="font-mono text-[11px] font-bold text-muted">{docRef(request.id)}</p>
        <p className="mt-0.5 text-[13px] text-muted">
          {docTypeLabel(request)} ·{" "}
          <span className={due.overdue && open ? "rounded-full bg-butter px-1.5 py-0.5 font-bold text-honey" : ""}>{due.text}</span>
        </p>
        <p className="mt-2 text-[14px] leading-5 text-ink">{label}</p>
      </div>

      {iAsked && request.recipient_count > 0 && (
        <div className="mx-4 mt-3">
          <div
            className="h-2.5 overflow-hidden rounded-full bg-mist"
            role="progressbar"
            aria-label="Accepted so far"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-leaf" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted">
            {request.accepted_count} of {request.recipient_count} accepted
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 pt-3 pb-4">
        {box}
        <Link
          href={href}
          className={`flex h-11 items-center justify-center rounded-xl text-sm font-bold ${
            box ? "border border-line bg-white text-ink hover:bg-mist" : "bg-brand text-white hover:bg-brand-hover"
          }`}
        >
          View Details
        </Link>
      </div>
    </div>
  );
}
