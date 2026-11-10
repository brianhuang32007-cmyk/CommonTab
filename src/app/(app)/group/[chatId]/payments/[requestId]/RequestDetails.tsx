"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CardIcon, CheckIcon, ChevronLeftIcon, CloseIcon, ReceiptIcon } from "@/components/app/icons";
import { PaymentLogo, type PaymentProvider } from "@/components/app/PaymentLogos";
import { useProfile } from "@/components/app/ProfileContext";
import { formatUsPhone } from "@/lib/profile";
import { useNotifications } from "@/components/app/NotificationsContext";
import { paymentRef } from "@/lib/alerts";
import { alertKey } from "@/lib/notificationReads";
import { signedLinks } from "@/lib/signedLinks";
import { createClient } from "@/lib/supabase/client";
import {
  disputeHref,
  disputeRoomHref,
  dollars,
  PAY_METHOD_LABEL,
  stamp,
  dueLabel,
  localDay,
  settleHref,
  SHARE_STATUS,
  type PaymentRequestDetails,
  type ShareEvent,
} from "../../../requests";
import DisputePanel, { disputeFor, useMyDisputes } from "./DisputePanel";

// A payment request's Details page. It adapts to who's looking: the requester sees what
// they're still owed, people paying see their share and Settle, everyone else sees that
// they're not in it. Everyone in the group sees each person's share and status, where to
// pay, the receipt and the activity. Settling itself comes in later steps.

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "ready"; request: PaymentRequestDetails };

const HANDLE_LABEL: Record<PaymentProvider, string> = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };

export default function RequestDetails() {
  const { chatId, requestId } = useParams<{ chatId: string; requestId: string }>();
  const { id: me } = useProfile();
  const { markAlertRead } = useNotifications();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [photo, setPhoto] = useState<string | null>(null);
  const markedRead = useRef(false);
  const { disputes } = useMyDisputes(requestId);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("payment_request_details", { req: requestId });
    if (error) return setState((s) => (s.status === "ready" ? s : { status: "error" }));
    if (!data) return setState({ status: "missing" });
    const request = data as PaymentRequestDetails;
    setState({ status: "ready", request });
    // Opened successfully: this request's reminder counts as read (the task stays until done).
    if (!markedRead.current) {
      markedRead.current = true;
      markAlertRead(alertKey.payment(requestId));
    }
    if (request.receipt_path) {
      const links = await signedLinks(supabase, "chat-files", [request.receipt_path]);
      setPhoto(links.get(request.receipt_path) ?? null);
    }
  }, [supabase, requestId, markAlertRead]);

  // Live: shares change as people settle (later steps), or the request is deleted.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`request-${requestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_shares" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payment_share_events" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "payment_transfers" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, requestId, load]);

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
          {state.status === "error" ? "Check your connection and try again." : "It may have been deleted, or you're not in this group."}
        </p>
        <Link
          href={back}
          className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
        >
          Back to the chat
        </Link>
      </div>
    );
  }

  const r = state.request;
  const iAmPayee = r.payee_id === me;
  const inSplit = r.my_share_cents !== null && !iAmPayee;
  const canDelete = r.created_by === me || r.my_role === "owner";
  const due = dueLabel(r.due_date);
  // A share canceled in a dispute (waived) no longer counts toward progress or what's owed.
  const counted = r.people.filter((p) => p.status !== "waived");
  const settled = counted.filter((p) => p.status === "settled");
  const collected = settled.reduce((a, p) => a + p.amount_cents, 0);
  const outstanding = counted.filter((p) => p.status !== "settled").reduce((a, p) => a + p.amount_cents, 0);
  const percent = counted.length ? Math.round((settled.length / counted.length) * 100) : 0;
  const allSettled = counted.length > 0 && settled.length === counted.length;
  const requester = r.creator ? (r.creator.user_id === me ? "you" : r.creator.first_name) : "a former member";
  const created = new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  // Each dispute has its own page: the member's open one (else their latest).
  const chatHref = (member: string) => {
    const d = disputeFor(disputes, member);
    return d ? disputeRoomHref(r.conversation_id, r.id, d.id) : null;
  };
  const stillOwing = counted.filter((p) => p.status !== "settled" && p.user_id !== r.payee_id).length;

  const chip = iAmPayee
    ? { text: "You requested", className: "bg-tint text-brand" }
    : inSplit
      ? { text: "You're paying", className: "bg-butter-strong text-[#5C4A0B]" }
      : { text: "Not in this request", className: "bg-mist text-muted" };

  return (
    <div className="mx-auto w-full max-w-[760px] pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {r.conversation_name ?? "the chat"}
      </Link>

      <div className="mt-2 flex flex-col gap-4">
        {/* 1. Header */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
              <CardIcon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${allSettled ? "bg-brand text-white" : "bg-tint text-brand"}`}
                >
                  {allSettled ? "Fully paid" : "Open"}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${chip.className}`}>{chip.text}</span>
              </div>
              <h2 className="mt-2 text-[26px] leading-tight font-extrabold tracking-tight break-words">{r.title}</h2>
              <PaymentId id={r.id} />
              <p className="mt-1 text-2xl font-extrabold">{dollars(r.total_cents)} total</p>
              <p className="mt-1 text-sm text-muted">
                <span className={due.overdue ? "rounded-full bg-butter px-2 py-0.5 font-bold text-honey" : ""}>{due.text}</span> · Requested
                by {requester} · {created}
              </p>
            </div>
            {canDelete && <DeleteButton requestId={r.id} onDeleted={() => router.push(back)} />}
          </div>
        </section>

        {/* 2. Your part */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          {iAmPayee ? (
            <>
              <p className="flex items-baseline justify-between gap-3 text-lg font-bold">
                You&apos;re still owed <span className="text-2xl font-extrabold text-brand">{dollars(outstanding)}</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                {dollars(collected)} collected of {dollars(r.total_cents)}
                {r.my_share_cents !== null ? ", including your own share" : ""}.
              </p>
              <p className="mt-3 rounded-2xl bg-tint px-4 py-3 text-sm text-ink">
                {stillOwing === 0
                  ? "Everyone has paid you. Nothing left to collect."
                  : `${stillOwing} ${stillOwing === 1 ? "person still owes" : "people still owe"} you. Each share turns Paid as soon as they pay.`}
              </p>
            </>
          ) : inSplit ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-3 text-lg font-bold">
                  Your share <span className="text-2xl font-extrabold text-ink">{dollars(r.my_share_cents ?? 0)}</span>
                </p>
                {r.my_share_status && (
                  <span
                    className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${SHARE_STATUS[r.my_share_status].className}`}
                  >
                    {SHARE_STATUS[r.my_share_status].label}
                  </span>
                )}
              </div>
              <PayerActions request={r} onChanged={load} chatHref={chatHref(me)} />
            </div>
          ) : (
            <p className="text-sm text-muted">You&apos;re not part of this request, so there&apos;s nothing for you to pay.</p>
          )}
        </section>

        {/* The private dispute chat: only the requester and whoever is disputing see anything here. */}
        {(iAmPayee || inSplit) && <DisputePanel chatId={r.conversation_id} requestId={r.id} disputes={disputes} iAmRequester={iAmPayee} />}

        {/* 3. Who's in it */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-extrabold">{iAmPayee ? "Who owes you" : "Who's in it"}</h3>
            <p className="text-sm text-muted">Split {r.split === "equal" ? "equally" : "by custom amounts"}</p>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-mist"
            role="progressbar"
            aria-label="Settled so far"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-leaf" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {settled.length} of {counted.length} settled
          </p>
          <ul className="mt-3 flex flex-col">
            {r.people.map((p) => {
              const status = SHARE_STATUS[p.status];
              const name = p.user_id === me ? "You" : `${p.first_name} ${p.last_name}`;
              return (
                <li key={p.user_id} className="flex flex-wrap items-center gap-3 border-b border-[#EEF1EA] py-2.5 last:border-b-0">
                  <Avatar src={p.avatar_url} name={`${p.first_name} ${p.last_name}`} seed={p.user_id} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold">
                      {name}
                      {p.user_id === r.payee_id && (
                        <span className="font-medium text-muted"> · {p.user_id === me ? "your own share" : "requester"}</span>
                      )}
                    </span>
                    <span className="truncate text-[13px] text-muted">@{p.username}</span>
                  </span>
                  <span className="shrink-0 font-bold">{dollars(p.amount_cents)}</span>
                  <span className={`w-[92px] shrink-0 rounded-full px-2 py-0.5 text-center text-xs font-bold ${status.className}`}>
                    {status.label}
                  </span>
                  {/* The requester talks with each person disputing in a private chat. */}
                  {iAmPayee && p.status === "disputed" && chatHref(p.user_id) && (
                    <Link
                      href={chatHref(p.user_id)!}
                      className="ml-12 flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
                    >
                      Open Dispute Chat
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* 4. Where the money goes: payers see who to pay and how; the requester sees how they get paid. */}
        {r.payee &&
          (iAmPayee ? (
            <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
              <h3 className="text-lg font-extrabold">How you get paid</h3>
              <p className="mt-1 text-sm text-muted">People in this request see these handles when they pay you.</p>
              <Handles payee={r.payee} isMe />
            </section>
          ) : inSplit ? (
            <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
              <h3 className="text-lg font-extrabold">Pay to</h3>
              <PayeeRow payee={r.payee} />
              <Handles payee={r.payee} isMe={false} />
            </section>
          ) : (
            <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
              <h3 className="text-lg font-extrabold">Paid to</h3>
              <PayeeRow payee={r.payee} />
            </section>
          ))}

        {/* Payments (demo, no real money): only the payer and the requester see these. */}
        {(r.transfers ?? []).length > 0 && (
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="text-lg font-extrabold">{iAmPayee ? "Payments Received" : "Your Payment"}</h3>
            <p className="mt-1 text-[13px] text-muted">Demo payments: no real money moved.</p>
            <ul className="mt-3 flex flex-col">
              {(r.transfers ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EEF1EA] py-2.5 last:border-b-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                    <CheckIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">
                      {t.payer_id === me ? "You" : `${t.first_name} ${t.last_name}`} paid {dollars(t.amount_cents)}
                    </span>
                    <span className="block text-[13px] text-muted">
                      {PAY_METHOD_LABEL[t.method]} · {stamp(t.created_at)}
                    </span>
                  </span>
                  <span className="rounded-lg bg-mist px-2 py-1 font-mono text-[13px] font-bold tracking-wider">{t.confirmation}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 5. Receipt */}
        {(r.receipt || r.receipt_path) && (
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="flex items-center gap-2 text-lg font-extrabold">
              <ReceiptIcon className="h-5 w-5 text-brand" />
              Receipt
            </h3>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row">
              {r.receipt_path && (
                <a
                  href={photo ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the receipt photo"
                  className="block w-full shrink-0 overflow-hidden rounded-2xl border border-line bg-mist sm:w-44"
                >
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- private, short-lived link
                    <img src={photo} alt="Receipt photo" className="max-h-64 w-full object-cover" />
                  ) : (
                    <span className="flex h-40 items-center justify-center text-xs text-muted">Loading photo…</span>
                  )}
                </a>
              )}
              {r.receipt && <DigitalReceiptView receipt={r.receipt} />}
            </div>
          </section>
        )}

        {/* 6. Activity */}
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <h3 className="text-lg font-extrabold">Activity</h3>
          <ol className="mt-3 flex flex-col gap-3">
            <ActivityItem
              text={`${r.creator ? (r.creator.user_id === me ? "You" : r.creator.first_name) : "Someone"} requested ${dollars(r.total_cents)}`}
              when={r.created_at}
            />
            {(r.events ?? []).map((e) => (
              <ActivityItem key={e.id} text={eventText(e, me)} when={e.created_at} done={e.kind === "paid"} />
            ))}
            {r.people
              .filter(
                (p) =>
                  p.status === "settled" &&
                  p.user_id !== r.payee_id &&
                  !(r.events ?? []).some((e) => e.kind === "paid" && e.user_id === p.user_id),
              )
              .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
              .map((p) => (
                <ActivityItem
                  key={p.user_id}
                  text={`${p.user_id === me ? "You" : p.first_name} settled ${dollars(p.amount_cents)}`}
                  when={p.updated_at}
                  done
                />
              ))}
          </ol>
          {!(r.events ?? []).length && settled.filter((p) => p.user_id !== r.payee_id).length === 0 && (
            <p className="mt-3 text-sm text-muted">Confirmations, disputes and payments will show here.</p>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------- Pieces ---------- */

/** A share's history line. Never shows a dispute's reason or chat (those are private). */
function eventText(e: ShareEvent, me: string) {
  const you = e.user_id === me;
  const name = you ? "You" : e.first_name;
  const whose = you ? "Your" : `${e.first_name}'s`;
  switch (e.kind) {
    case "confirmed":
      return `${name} confirmed ${you ? "your" : "their"} share of ${dollars(e.amount_cents ?? 0)}`;
    case "disputed":
      return `${name} disputed ${you ? "your" : "their"} share of ${dollars(e.amount_cents ?? 0)}`;
    case "amount_changed":
      return `${whose} share changed from ${dollars(e.previous_cents ?? 0)} to ${dollars(e.amount_cents ?? 0)} after a dispute`;
    case "waived":
      return `${whose} payment was canceled after a dispute`;
    case "dispute_canceled":
      return `${name} canceled ${you ? "your" : "their"} dispute; the share stays ${dollars(e.amount_cents ?? 0)}`;
    case "paid":
      return `${name} paid ${dollars(e.amount_cents ?? 0)}`;
  }
}

/** What someone paying can do next: confirm, then settle; dispute while Pending or Confirmed. */
function PayerActions({
  request: r,
  onChanged,
  chatHref,
}: {
  request: PaymentRequestDetails;
  onChanged: () => void;
  chatHref: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const status = r.my_share_status;
  const payee = r.payee?.first_name ?? "the requester";

  async function confirm() {
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("confirm_payment_share", { req: r.id });
    setBusy(false);
    if (error) setProblem(error.message);
    else onChanged();
  }

  const dispute = (
    <Link
      href={disputeHref(r.conversation_id, r.id)}
      className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line bg-white px-6 font-bold text-ink hover:bg-mist sm:flex-none"
    >
      Dispute
    </Link>
  );
  const primary =
    "flex h-12 flex-1 items-center justify-center rounded-xl bg-brand px-6 font-bold text-white hover:bg-brand-hover disabled:opacity-60 sm:flex-none";

  let note: string | null = null;
  let buttons: React.ReactNode = null;
  if (status === "pending") {
    note = "Check the amount, then confirm it before paying.";
    buttons = (
      <>
        {dispute}
        <button type="button" onClick={confirm} disabled={busy} className={primary}>
          {busy ? "Confirming…" : "Confirm"}
        </button>
      </>
    );
  } else if (status === "confirmed") {
    buttons = (
      <>
        {dispute}
        <Link href={settleHref(r.conversation_id, r.id)} className={primary}>
          Settle
        </Link>
      </>
    );
  } else if (status === "disputed") {
    note = `You're disputing this share. Work it out with ${payee} in the dispute chat before paying.`;
    buttons = chatHref && (
      <Link href={chatHref} className={primary}>
        Open Dispute Chat
      </Link>
    );
  } else if (status === "waived") {
    note = `${payee} canceled your payment after your dispute. You don't owe anything.`;
  } else if (status === "settled") {
    note = `You paid ${payee}. Your receipt is below.`;
  }

  return (
    <>
      {buttons && <div className="flex w-full gap-2 sm:w-auto">{buttons}</div>}
      {note && (
        <p className={`w-full text-sm ${status === "disputed" ? "rounded-2xl bg-butter px-4 py-3 text-ink" : "text-muted"}`}>{note}</p>
      )}
      {problem && (
        <p role="alert" className="w-full text-sm font-semibold text-warn">
          {problem}
        </p>
      )}
    </>
  );
}

function PayeeRow({ payee }: { payee: NonNullable<PaymentRequestDetails["payee"]> }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <Avatar src={payee.avatar_url} name={`${payee.first_name} ${payee.last_name}`} seed={payee.user_id} size={40} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-bold">
          {payee.first_name} {payee.last_name}
        </span>
        <span className="truncate text-[13px] text-muted">@{payee.username}</span>
      </span>
    </div>
  );
}

function Handles({ payee, isMe }: { payee: NonNullable<PaymentRequestDetails["payee"]>; isMe: boolean }) {
  const [copied, setCopied] = useState<PaymentProvider | null>(null);
  const handles: { key: PaymentProvider; value: string; copy: string }[] = [];
  if (payee.venmo_username) handles.push({ key: "venmo", value: `@${payee.venmo_username}`, copy: payee.venmo_username });
  if (payee.paypal_username)
    handles.push({ key: "paypal", value: `paypal.me/${payee.paypal_username}`, copy: `paypal.me/${payee.paypal_username}` });
  if (payee.zelle_contact) handles.push({ key: "zelle", value: formatUsPhone(payee.zelle_contact), copy: payee.zelle_contact });
  handles.sort((a, b) => Number(b.key === payee.preferred_handle) - Number(a.key === payee.preferred_handle));

  if (!handles.length) {
    return (
      <p className="mt-3 rounded-2xl bg-butter px-4 py-3 text-sm text-ink">
        <span className="font-bold text-honey">No payment handles yet.</span>{" "}
        {isMe ? (
          <>
            Add one in{" "}
            <Link href="/preferences#payment-handles" className="font-bold text-brand underline">
              Preferences
            </Link>{" "}
            so people know where to pay you.
          </>
        ) : (
          <>Ask {payee.first_name} how they&apos;d like to be paid.</>
        )}
      </p>
    );
  }
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {handles.map((h) => (
        <li key={h.key} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2">
          <PaymentLogo provider={h.key} className="h-8 w-8" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold">
              {HANDLE_LABEL[h.key]}
              {h.key === payee.preferred_handle && <span className="font-medium text-muted"> · preferred</span>}
            </span>
            <span className="truncate text-sm text-[#3E4A43]">{h.value}</span>
          </span>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(h.copy).catch(() => {});
              setCopied(h.key);
              setTimeout(() => setCopied((c) => (c === h.key ? null : c)), 1500);
            }}
            className="h-10 shrink-0 rounded-lg border border-line bg-white px-3 text-sm font-bold hover:bg-mist"
          >
            {copied === h.key ? "Copied" : "Copy"}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DigitalReceiptView({ receipt }: { receipt: NonNullable<PaymentRequestDetails["receipt"]> }) {
  const date = receipt.date
    ? localDay(receipt.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const line = (label: string, cents: number | null, strong = false) =>
    cents === null ? null : (
      <div className={`flex justify-between ${strong ? "border-t border-line pt-2 text-base font-extrabold" : "text-sm"}`}>
        <span>{label}</span>
        <span>{dollars(cents)}</span>
      </div>
    );
  return (
    <div className="min-w-0 flex-1 rounded-2xl border border-line bg-mist p-4">
      <p className="text-[11px] font-bold tracking-[0.14em] text-[#3E4A43] uppercase">Digital receipt</p>
      {receipt.vendor && <p className="mt-1.5 font-extrabold">{receipt.vendor}</p>}
      {date && <p className="text-sm text-muted">{date}</p>}
      {receipt.items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {receipt.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="shrink-0">{dollars(item.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-1 border-t border-line pt-2">
        {line("Subtotal", receipt.subtotal_cents)}
        {line("Tax", receipt.tax_cents)}
        {line("Tip", receipt.tip_cents)}
        {line("Total", receipt.total_cents, true)}
      </div>
    </div>
  );
}

function ActivityItem({ text, when, done = false }: { text: string; when: string; done?: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-brand text-white" : "bg-tint text-brand"}`}
      >
        {done ? <CheckIcon className="h-3.5 w-3.5" /> : <CardIcon className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 text-sm">{text}</span>
      <time dateTime={when} className="shrink-0 text-xs text-muted">
        {new Date(when).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
      </time>
    </li>
  );
}

/** × with a "can't be undone" confirmation (group owner or whoever made the request). */
function DeleteButton({ requestId, onDeleted }: { requestId: string; onDeleted: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete this request"
        title="Delete this request"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-mist hover:text-ink"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label="Delete this request?" className="w-full max-w-[260px] shrink-0 rounded-xl bg-butter p-3">
      <p className="text-sm font-bold text-honey">Delete this request for everyone?</p>
      <p className="mt-0.5 text-[13px] text-ink">This can&apos;t be undone.</p>
      {problem && <p className="mt-1 text-[13px] font-semibold text-warn">{problem}</p>}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem(null);
            const { error } = await supabase.rpc("delete_payment_request", { req: requestId });
            if (error) {
              setProblem(error.message);
              setBusy(false);
            } else onDeleted();
          }}
          className="h-10 rounded-lg bg-ink px-3.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
        >
          {busy ? "Deleting…" : "Yes, Delete"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="h-10 rounded-lg border border-line bg-white px-3.5 text-sm font-bold disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The request's short payment ID (PR-…), with Copy. Search it on Alerts & Reminders → Payments. */
function PaymentId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const ref = paymentRef(id);
  return (
    <p className="mt-1 flex items-center gap-2 text-sm text-muted">
      Payment ID <span className="font-mono font-bold text-ink">{ref}</span>
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
