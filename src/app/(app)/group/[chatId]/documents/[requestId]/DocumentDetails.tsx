"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CheckIcon, ChevronLeftIcon, CloseIcon, FileIcon } from "@/components/app/icons";
import { useNotifications } from "@/components/app/NotificationsContext";
import { useProfile } from "@/components/app/ProfileContext";
import { alertKey } from "@/lib/notificationReads";
import { createClient } from "@/lib/supabase/client";
import { DOC_STATUS, docRef, docTypeLabel, type DocEvent, type DocumentDetails as Details } from "../../../documents";
import { dueLabel } from "../../../requests";
import { AiBadge, CantProvide, ReasonBox, SenderUpload, UploadCard } from "./parts";

// A document request's page. It adapts to who's looking: the requester sees who has sent
// what, opens the files, runs AI Verify if they want, and accepts or rejects each upload.
// People asked upload their files (and can run AI Verify before sending), replace them until
// they're reviewed, upload again after a rejection, or say they can't provide it. Everyone else
// in the chat sees the request and each person's status, never the files.

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "ready"; request: Details };

export default function DocumentDetails() {
  const { chatId, requestId } = useParams<{ chatId: string; requestId: string }>();
  const { id: me } = useProfile();
  const { markAlertRead } = useNotifications();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  // Your role in the group (the owner can cancel anyone's request; DMs have no owner).
  const [role, setRole] = useState<string | null>(null);
  const markedRead = useRef(false);
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    const [{ data, error }, mine] = await Promise.all([
      supabase.rpc("document_request_details", { req: requestId }),
      supabase.rpc("my_group_role", { target: chatId }),
    ]);
    if (!mine.error) setRole((mine.data as string | null) ?? null);
    if (error) return setState((s) => (s.status === "ready" ? s : { status: "error" }));
    if (!data) return setState({ status: "missing" });
    setState({ status: "ready", request: data as Details });
    // Opened: this request's alerts count as read (its task stays until it's done).
    if (!markedRead.current) {
      markedRead.current = true;
      markAlertRead(alertKey.document(requestId));
    }
  }, [supabase, requestId, chatId, markAlertRead]);

  // Live: someone uploads, the requester reviews, or the request closes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`document-${requestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_recipients" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_requests" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "document_events" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, requestId, load]);

  // Opened from the card's Upload Document box: go straight to the upload.
  useEffect(() => {
    if (state.status !== "ready" || scrolled.current) return;
    scrolled.current = true;
    if (window.location.hash === "#upload") document.getElementById("upload")?.scrollIntoView({ block: "start" });
  }, [state.status]);

  const back = `/group?chat=${chatId}`;

  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading the request…
      </p>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">{state.status === "error" ? "Couldn't load this request" : "This request isn't available"}</p>
        <p className="mt-1.5 text-sm text-muted">
          {state.status === "error" ? "Check your connection and try again." : "It may have been removed, or you're not in this chat."}
        </p>
        <Link href={back} className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
          Back to the chat
        </Link>
      </div>
    );
  }

  const r = state.request;
  const iAsked = r.created_by === me;
  const mine = r.people.find((p) => p.user_id === me) ?? null;
  const open = r.status === "open";
  const canCancel = open && (iAsked || role === "owner");
  const due = dueLabel(r.due_date);
  const requester = r.creator ? (r.creator.user_id === me ? "you" : r.creator.first_name) : "a former member";
  const created = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const percent = r.recipient_count ? Math.round((r.accepted_count / r.recipient_count) * 100) : 0;
  const nameOf = (id: string) => {
    if (id === me) return "You";
    const p = r.people.find((x) => x.user_id === id);
    return p ? `${p.first_name} ${p.last_name}` : "A former member";
  };
  // What's been sent (never drafts): newest first. Replaced ones go under "Earlier uploads".
  const sent = r.uploads.filter((u) => u.status !== "draft");
  const current = sent.filter((u) => u.status !== "replaced");
  const earlier = sent.filter((u) => u.status === "replaced");

  const statusChip =
    r.status === "complete"
      ? { text: "Complete", className: "bg-brand text-white" }
      : r.status === "cancelled"
        ? { text: "Canceled", className: "bg-mist text-muted" }
        : { text: "Open", className: "bg-tint text-brand" };
  const roleChip = iAsked
    ? { text: "You requested", className: "bg-tint text-brand" }
    : mine
      ? { text: "You're asked", className: "bg-butter-strong text-[#5C4A0B]" }
      : { text: "Not in this request", className: "bg-mist text-muted" };

  return (
    <div className="mx-auto w-full max-w-[760px] pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {r.conversation_name ?? (r.conversation_kind === "dm" ? "the chat" : "the group")}
      </Link>

      <div className="mt-2 flex flex-col gap-4">
        {/* 1. Header */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
              <FileIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusChip.className}`}>{statusChip.text}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${roleChip.className}`}>{roleChip.text}</span>
              </div>
              <h2 className="mt-2 text-[26px] leading-tight font-extrabold tracking-tight break-words">{r.title}</h2>
              <RequestId id={r.id} />
              <p className="mt-1 text-sm text-muted">
                {docTypeLabel(r)} · <span className={due.overdue && open ? "rounded-full bg-butter px-2 py-0.5 font-bold text-honey" : ""}>{due.text}</span> ·
                Requested by {requester} · {created}
              </p>
              {r.instructions && (
                <div className="mt-3 rounded-2xl bg-mist px-4 py-3">
                  <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Instructions</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{r.instructions}</p>
                </div>
              )}
            </div>
            {canCancel && <CancelButton requestId={r.id} asOwner={!iAsked} onDone={load} />}
          </div>
        </section>

        {/* 2. Your part */}
        {iAsked ? (
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <p className="flex items-baseline justify-between gap-3 text-lg font-bold">
              Accepted{" "}
              <span className="text-2xl font-extrabold text-brand">
                {r.accepted_count} of {r.recipient_count}
              </span>
            </p>
            <div
              className="mt-3 h-2.5 overflow-hidden rounded-full bg-mist"
              role="progressbar"
              aria-label="Accepted so far"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-leaf" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-3 rounded-2xl bg-tint px-4 py-3 text-sm text-ink">
              {r.status === "cancelled"
                ? "This request was canceled. Files already sent stay here for you and the person who sent them."
                : r.status === "complete"
                  ? "Everyone has been handled. Nothing left to review."
                  : r.waiting_count
                    ? `${r.waiting_count === 1 ? "1 document is" : `${r.waiting_count} documents are`} waiting for your review below. Run AI Verify, or open the files to check them yourself, then accept or reject.`
                    : "Waiting for people to send their documents. You'll get an alert when one arrives."}
            </p>
          </section>
        ) : mine ? (
          <section id="upload" className="scroll-mt-4 rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-extrabold">Your part</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${DOC_STATUS[mine.status].className}`}>{DOC_STATUS[mine.status].label}</span>
            </div>
            {mine.status === "rejected" && mine.reason && <ReasonBox title="Why it was rejected" text={mine.reason} />}
            {mine.status === "cant_provide" && mine.reason && <ReasonBox title="You said you can't provide it" text={mine.reason} tone="muted" />}
            {!open ? (
              <p className="mt-3 text-sm text-muted">
                {r.status === "cancelled" ? "This request was canceled, so nothing more is needed." : "This request is complete."}
              </p>
            ) : mine.status === "accepted" ? (
              <p className="mt-3 flex items-center gap-2 rounded-2xl bg-tint px-4 py-3 text-sm font-bold text-brand">
                <CheckIcon className="h-4 w-4" />
                Your document was accepted. Nothing more to do.
              </p>
            ) : (
              <>
                <SenderUpload request={r} me={me} status={mine.status} onSent={load} />
                {(mine.status === "requested" || mine.status === "rejected") && <CantProvide requestId={r.id} onDone={load} />}
              </>
            )}
          </section>
        ) : (
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <p className="text-sm text-muted">
              You weren&apos;t asked for this document. Only {requester === "you" ? "you" : requester} and the people asked can open the files.
            </p>
          </section>
        )}

        {/* 3. Who's sending */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <h3 className="text-lg font-extrabold">{iAsked ? "Who's sending" : "Who was asked"}</h3>
          <ul className="mt-2 flex flex-col">
            {r.people.map((p) => {
              const st = DOC_STATUS[p.status];
              return (
                <li key={p.user_id} className="border-b border-[#EEF1EA] py-2.5 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Avatar src={p.avatar_url} name={`${p.first_name} ${p.last_name}`} seed={p.user_id} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-bold">{p.user_id === me ? "You" : `${p.first_name} ${p.last_name}`}</span>
                      <span className="truncate text-[13px] text-muted">@{p.username}</span>
                    </span>
                    {/* The AI result on their latest upload (only the requester and that person see uploads). */}
                    <AiBadge status={current.find((u) => u.user_id === p.user_id)?.ai_status ?? null} />
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-bold ${st.className}`}>{st.label}</span>
                  </div>
                  {iAsked && p.reason && (p.status === "rejected" || p.status === "cant_provide") && (
                    <p className="mt-1.5 ml-12 text-[13px] text-muted">
                      {p.status === "rejected" ? "You said: " : "They said: "}
                      <span className="text-ink">{p.reason}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* 4. What's been sent (only the requester and the person who sent it) */}
        {(iAsked || mine) && current.length > 0 && (
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="text-lg font-extrabold">{iAsked ? "Documents received" : "What you sent"}</h3>
            <p className="mt-0.5 text-sm text-muted">Only you and {iAsked ? "the person who sent each one" : requester} can open these files.</p>
            <div className="mt-3 flex flex-col gap-3">
              {current.map((u) => (
                <UploadCard
                  key={u.id}
                  upload={u}
                  chatId={r.conversation_id}
                  requestId={r.id}
                  who={nameOf(u.user_id)}
                  canReview={iAsked && open && u.status === "submitted"}
                  canVerify={open && u.status === "submitted" && (iAsked || u.user_id === me)}
                  onChanged={load}
                />
              ))}
            </div>
            {earlier.length > 0 && (
              <details className="mt-3 rounded-2xl border border-line px-4 py-2">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-ink">
                  Earlier uploads ({earlier.length})
                </summary>
                <div className="flex flex-col gap-3 pb-2">
                  {earlier.map((u) => (
                    <UploadCard
                      key={u.id}
                      upload={u}
                      chatId={r.conversation_id}
                      requestId={r.id}
                      who={nameOf(u.user_id)}
                      canReview={false}
                      canVerify={false}
                      onChanged={load}
                    />
                  ))}
                </div>
              </details>
            )}
          </section>
        )}

        {/* 5. Activity */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <h3 className="text-lg font-extrabold">Activity</h3>
          <ul className="mt-3 flex flex-col gap-3">
            <ActivityItem text={`Requested by ${requester === "you" ? "you" : requester}`} when={r.created_at} />
            {activity(r.events).map((e) => (
              <ActivityItem key={e.id} text={eventText(e, me)} note={e.note} when={e.created_at} done={e.kind === "accepted"} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** Canceling shows once, not once per person. */
function activity(events: DocEvent[]) {
  let canceled = false;
  return events.filter((e) => {
    if (e.kind !== "cancelled") return true;
    if (canceled) return false;
    canceled = true;
    return true;
  });
}

function eventText(e: DocEvent, me: string) {
  const you = e.user_id === me;
  const name = you ? "You" : e.first_name;
  switch (e.kind) {
    case "submitted":
      return `${name} sent ${you ? "your" : "their"} document`;
    case "accepted":
      return `${you ? "Your" : `${e.first_name}'s`} document was accepted`;
    case "rejected":
      return `${you ? "Your" : `${e.first_name}'s`} document was rejected`;
    case "cant_provide":
      return `${name} can't provide it`;
    case "cancelled":
      return "The request was canceled";
  }
}

function ActivityItem({ text, note, when, done = false }: { text: string; note?: string | null; when: string; done?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-brand text-white" : "bg-tint text-brand"}`}>
        {done ? <CheckIcon className="h-3.5 w-3.5" /> : <FileIcon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        {text}
        {note && <span className="block text-[13px] text-muted">&ldquo;{note}&rdquo;</span>}
      </span>
      <time dateTime={when} className="shrink-0 text-xs text-muted">
        {new Date(when).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </time>
    </li>
  );
}

/** The request's short ID (DR-…), with Copy. */
function RequestId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const ref = docRef(id);
  return (
    <p className="mt-1 flex items-center gap-2 text-sm text-muted">
      Request ID <span className="font-mono font-bold text-ink">{ref}</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(ref).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="h-8 rounded-lg border border-line bg-white px-2.5 text-xs font-bold text-ink hover:bg-mist"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </p>
  );
}

/** × at the top: cancel the request (the requester or the group owner), with a confirmation.
 *  Files already sent stay private to the requester and whoever sent them. */
function CancelButton({ requestId, asOwner, onDone }: { requestId: string; asOwner: boolean; onDone: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Cancel this request"
        title="Cancel this request"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-mist hover:text-ink"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label="Cancel this request?" className="w-full max-w-[260px] shrink-0 rounded-xl bg-butter p-3">
      <p className="text-sm font-bold text-honey">Cancel this request for everyone?</p>
      <p className="mt-0.5 text-[13px] text-ink">
        {asOwner ? "As the group owner you can cancel anyone's request. " : ""}Nobody can upload to it any more. Files already sent stay private.
      </p>
      {problem && <p className="mt-1 text-[13px] font-semibold text-warn">{problem}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem(null);
            const { error } = await supabase.rpc("cancel_document_request", { req: requestId });
            setBusy(false);
            if (error) setProblem(error.message);
            else {
              setConfirming(false);
              onDone();
            }
          }}
          className="h-10 rounded-lg bg-ink px-3.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
        >
          {busy ? "Canceling…" : "Yes, Cancel"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="h-10 rounded-lg border border-line bg-white px-3.5 text-sm font-bold disabled:opacity-60"
        >
          Keep It
        </button>
      </div>
    </div>
  );
}
