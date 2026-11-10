"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { ChevronLeftIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import {
  detailsHref,
  dollars,
  parseCents,
  SHARE_STATUS,
  stamp,
  TOTAL_MAX_CENTS,
  type DisputeProposal,
  type PaymentDispute,
  type PaymentRequestDetails,
} from "../../../../../requests";
import { DisputeStatusChip, useMyDisputes } from "../../DisputePanel";

// One dispute's own page. Chat on the left (the reason pinned on top, messages, and short
// notes for each proposal and decision); the negotiation tool on the right (the current
// proposal and its answers, proposing a new share, proposing canceling, the history and
// the outcome). On phones the negotiation sits on top with the chat below it.
// Only the requester and the person disputing can open it. Every change goes through the
// database's checked functions; nothing here changes a share by itself.

type Supabase = ReturnType<typeof createClient>;
type Who = (id: string | null) => string;

export default function DisputeRoom() {
  const { chatId, requestId, disputeId } = useParams<{ chatId: string; requestId: string; disputeId: string }>();
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const { disputes, reload } = useMyDisputes(requestId);
  const [request, setRequest] = useState<PaymentRequestDetails | null | "error">(null);

  // The request: its title, the requester, and the member's current share (live).
  const loadRequest = useCallback(async () => {
    const { data, error } = await supabase.rpc("payment_request_details", { req: requestId });
    setRequest((r) => (error ? (r && r !== "error" ? r : "error") : ((data as PaymentRequestDetails | null) ?? "error")));
  }, [supabase, requestId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(loadRequest, 0);
    const channel = supabase
      .channel(`dispute-room-${disputeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_shares" }, () => {
        clearTimeout(timer);
        timer = setTimeout(loadRequest, 150);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, disputeId, loadRequest]);

  const back = detailsHref(chatId, requestId);
  const dispute = disputes?.find((d) => d.id === disputeId) ?? null;

  if (disputes === null || request === null) {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading the dispute…
      </p>
    );
  }
  if (!dispute || request === "error") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">This dispute isn&apos;t available</p>
        <p className="mt-1.5 text-sm text-muted">Only the requester and the person disputing can open it.</p>
        <Link
          href={back}
          className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
        >
          Back to the request
        </Link>
      </div>
    );
  }

  const member = dispute.member;
  const payee = request.payee;
  const iAmRequester = payee?.user_id === me;
  const other = iAmRequester ? member : payee;
  const otherName = other ? `${other.first_name} ${other.last_name}` : "the requester";
  const share = request.people.find((p) => p.user_id === member.user_id) ?? null;
  const open = dispute.status === "open" ? (dispute.proposals.find((p) => p.status === "open") ?? null) : null;
  const who: Who = (id) =>
    id === me ? "You" : id === member.user_id ? member.first_name : id && id === payee?.user_id ? payee.first_name : "Someone";
  const changed = () => {
    reload();
    loadRequest();
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] pb-6">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {request.title}
      </Link>

      {/* Header */}
      <section className="mt-2 rounded-3xl border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          {other && <Avatar src={other.avatar_url} name={otherName} seed={other.user_id} size={44} />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Dispute · {request.title}</p>
            <h2 className="truncate text-[22px] leading-tight font-extrabold tracking-tight sm:text-[26px]">With {otherName}</h2>
          </div>
          <DisputeStatusChip dispute={dispute} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:max-w-md">
          <div className="rounded-xl bg-mist px-3 py-2">
            <dt className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">Original amount</dt>
            <dd className="text-lg font-extrabold">{dollars(dispute.original_cents)}</dd>
          </div>
          <div className="rounded-xl bg-mist px-3 py-2">
            <dt className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">Current share</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-extrabold">{share ? dollars(share.amount_cents) : "—"}</span>
              {share && (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${SHARE_STATUS[share.status].className}`}>
                  {SHARE_STATUS[share.status].label}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[13px] text-muted">Private: only you and {other?.first_name ?? "the requester"} can see this page.</p>
      </section>

      {/* Desktop: chat on the left, negotiation on the right. Phone: negotiation on top, chat below. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="order-2 flex h-[70vh] min-h-[420px] flex-col rounded-3xl border border-line bg-white lg:order-1 lg:h-[calc(100vh-280px)] lg:min-h-[480px]">
          <ChatColumn dispute={dispute} me={me} who={who} supabase={supabase} onSent={changed} />
        </section>

        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <Negotiation dispute={dispute} me={me} who={who} iAmRequester={iAmRequester} open={open} onChanged={changed} />
        </aside>
      </div>
    </div>
  );
}

/* ---------- Left: the chat ---------- */

type Item =
  { at: string; kind: "message"; id: string; author: string | null; body: string } | { at: string; kind: "note"; id: string; text: string };

/** Messages, plus a short note for each proposal and decision, in time order. */
function timeline(dispute: PaymentDispute, me: string, who: Who): Item[] {
  const member = dispute.member;
  const list: Item[] = dispute.messages.map((m) => ({ at: m.created_at, kind: "message", id: m.id, author: m.author_id, body: m.body }));
  dispute.proposals.forEach((p, i) => {
    list.push({
      at: p.created_at,
      kind: "note",
      id: `p-${p.id}`,
      text: `${who(p.author_id)} ${verbFor(dispute.proposals, i)} ${proposalText(p, who(member.user_id))}.`,
    });
    if (p.status === "accepted" && p.decided_at) {
      list.push({
        at: p.decided_at,
        kind: "note",
        id: `a-${p.id}`,
        text:
          p.kind === "amount"
            ? `${who(p.decided_by)} accepted ${dollars(p.amount_cents ?? 0)}. The share goes back to Pending until ${member.user_id === me ? "you confirm" : `${member.first_name} confirms`} it.`
            : `${who(p.decided_by)} accepted canceling the payment. ${member.user_id === me ? "You don't" : `${member.first_name} doesn't`} owe anything now.`,
      });
    }
    if (p.status === "persisted" && p.decided_at) {
      list.push({
        at: p.decided_at,
        kind: "note",
        id: `k-${p.id}`,
        text: `${who(p.decided_by)} kept the original amount of ${dollars(dispute.original_cents)}.`,
      });
    }
  });
  return list.sort((a, b) => a.at.localeCompare(b.at));
}

function verbFor(proposals: DisputeProposal[], i: number) {
  const before = proposals[i - 1];
  const p = proposals[i];
  if (before?.status === "countered" && before.decided_by === p.author_id) return "countered with";
  if (before?.status === "replaced" && before.author_id === p.author_id) return "changed their proposal to";
  return "proposed";
}

function proposalText(p: DisputeProposal, memberName: string) {
  if (p.kind === "cancel") return memberName === "You" ? "canceling your payment" : `canceling ${memberName}'s payment`;
  return dollars(p.amount_cents ?? 0);
}

function ChatColumn({
  dispute,
  me,
  who,
  supabase,
  onSent,
}: {
  dispute: PaymentDispute;
  me: string;
  who: Who;
  supabase: Supabase;
  onSent: () => void;
}) {
  const items = timeline(dispute, me, who);
  const list = useRef<HTMLOListElement>(null);
  const count = items.length;
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <>
      <div className="m-3 rounded-2xl bg-butter px-4 py-3">
        <p className="text-[11px] font-bold tracking-[0.12em] text-honey uppercase">
          {dispute.member.user_id === me ? "Your reason" : `${dispute.member.first_name}'s reason`} · {stamp(dispute.created_at)}
        </p>
        <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{dispute.reason}</p>
      </div>

      <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2" aria-label="Dispute chat" aria-live="polite">
        {items.length === 0 && <li className="m-auto text-sm text-muted">No messages yet. Say what you think is fair.</li>}
        {items.map((item) =>
          item.kind === "note" ? (
            <li key={item.id} className="mx-auto max-w-[90%] rounded-xl bg-mist px-3 py-1.5 text-center text-[13px] text-[#3E4A43]">
              {item.text} <span className="text-muted">· {stamp(item.at)}</span>
            </li>
          ) : (
            <li key={item.id} className={`flex flex-col ${item.author === me ? "items-end" : "items-start"}`}>
              <span className="text-[11px] text-muted">
                {who(item.author)} · {stamp(item.at)}
              </span>
              <span
                className={`mt-0.5 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${
                  item.author === me ? "bg-tint text-ink" : "border border-line bg-white text-ink"
                }`}
              >
                {item.body}
              </span>
            </li>
          ),
        )}
      </ol>

      <div className="border-t border-line p-3">
        <Composer disputeId={dispute.id} supabase={supabase} onSent={onSent} />
      </div>
    </>
  );
}

function Composer({ disputeId, supabase, onSent }: { disputeId: string; supabase: Supabase; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useRef<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    if (body.length > 1000) return setProblem("Messages are up to 1,000 characters.");
    setBusy(true);
    setProblem(null);
    id.current ??= crypto.randomUUID();
    const { error } = await supabase.rpc("send_dispute_message", { msg_id: id.current, target: disputeId, message_body: body });
    setBusy(false);
    if (error) return setProblem(`${error.message.replace(/\.$/, "")}. Your message is still here; try again.`);
    id.current = null;
    setText("");
    onSent();
  }

  return (
    <form onSubmit={send}>
      <div className="flex items-end gap-2">
        <label htmlFor="dispute-message" className="sr-only">
          Message
        </label>
        <textarea
          id="dispute-message"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            id.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Write a message…"
          className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="h-11 shrink-0 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-1.5 text-[13px] font-semibold text-warn">
          {problem}
        </p>
      )}
    </form>
  );
}

/* ---------- Right: the negotiation tool ---------- */

const PROPOSAL_STATUS: Record<DisputeProposal["status"], { label: string; className: string }> = {
  open: { label: "Open", className: "bg-butter-strong text-[#5C4A0B]" },
  accepted: { label: "Accepted", className: "bg-brand text-white" },
  countered: { label: "Countered", className: "bg-mist text-muted" },
  replaced: { label: "Replaced", className: "bg-mist text-muted" },
  persisted: { label: "Kept original", className: "bg-butter text-honey" },
};

const card = "rounded-3xl border border-line bg-white p-5";
const label = "text-[11px] font-bold tracking-[0.14em] text-muted uppercase";

function Negotiation({
  dispute,
  me,
  who,
  iAmRequester,
  open,
  onChanged,
}: {
  dispute: PaymentDispute;
  me: string;
  who: Who;
  iAmRequester: boolean;
  open: DisputeProposal | null;
  onChanged: () => void;
}) {
  const memberName = who(dispute.member.user_id);
  const isOpen = dispute.status === "open";

  return (
    <>
      {/* Outcome, once it's settled */}
      {!isOpen && (
        <section className={`${card} bg-tint`}>
          <p className={label}>Outcome</p>
          <p className="mt-1 text-lg font-extrabold">
            {dispute.resolution === "waived" ? "Payment canceled" : `Share changed to ${dollars(dispute.final_cents ?? 0)}`}
          </p>
          <p className="mt-1 text-sm text-ink">
            {dispute.resolution === "waived"
              ? `${memberName === "You" ? "You don't" : `${memberName} doesn't`} owe anything for this request.`
              : `${memberName === "You" ? "Confirm it" : `${memberName} confirms it`} on the request before paying.`}
          </p>
          {dispute.resolved_at && <p className="mt-1 text-[13px] text-muted">{stamp(dispute.resolved_at)}</p>}
        </section>
      )}

      {/* Current proposal */}
      {isOpen && (
        <section className={card} aria-labelledby="current-proposal">
          <p id="current-proposal" className={label}>
            Current proposal
          </p>
          {open ? (
            <OpenProposal
              disputeId={dispute.id}
              proposal={open}
              me={me}
              iAmRequester={iAmRequester}
              who={who}
              memberName={memberName}
              onChanged={onChanged}
            />
          ) : (
            <p className="mt-1.5 text-sm text-muted">No open proposal. Propose a new share below, or keep talking in the chat.</p>
          )}
        </section>
      )}

      {/* Propose a new share, or canceling */}
      {isOpen && (
        <section className={card}>
          <p className={label}>Propose a new share</p>
          <p className="mt-1 text-sm text-muted">
            {iAmRequester ? `Offer a different amount for ${memberName}'s share.` : "Suggest what you think your share should be."}
            {open?.author_id === me && " It replaces your current proposal."}
          </p>
          <AmountForm
            disputeId={dispute.id}
            fieldLabel="New share amount"
            submitLabel={open && open.author_id !== me ? "Send Counter" : "Send Proposal"}
            onDone={onChanged}
          />
          {!iAmRequester && <ProposeCancel disputeId={dispute.id} onChanged={onChanged} />}
        </section>
      )}

      {/* History */}
      <section className={card}>
        <p className={label}>History</p>
        {dispute.proposals.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted">No proposals yet.</p>
        ) : (
          <ol className="mt-2 flex flex-col">
            {[...dispute.proposals].reverse().map((p) => {
              const i = dispute.proposals.indexOf(p);
              const s = PROPOSAL_STATUS[p.status];
              return (
                <li key={p.id} className="flex items-start gap-3 border-b border-[#EEF1EA] py-2.5 last:border-b-0">
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-bold">{who(p.author_id)}</span> {verbFor(dispute.proposals, i)} {proposalText(p, memberName)}
                    <span className="block text-[12px] text-muted">
                      {stamp(p.created_at)}
                      {p.decided_at &&
                        p.status !== "open" &&
                        ` · ${s.label.toLowerCase()} by ${who(p.decided_by).toLowerCase() === "you" ? "you" : who(p.decided_by)}`}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.className}`}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

function OpenProposal({
  disputeId,
  proposal,
  me,
  iAmRequester,
  who,
  memberName,
  onChanged,
}: {
  disputeId: string;
  proposal: DisputeProposal;
  me: string;
  iAmRequester: boolean;
  who: Who;
  memberName: string;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [countering, setCountering] = useState(false);
  const mine = proposal.author_id === me;

  async function answer(decision: "accept" | "persist") {
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("respond_dispute_proposal", { target: proposal.id, decision });
    setBusy(false);
    if (error) setProblem(error.message);
    else onChanged();
  }

  return (
    <div className="mt-2 rounded-2xl bg-butter-strong px-4 py-3">
      <p className="text-lg font-extrabold">
        {mine ? "You propose" : `${who(proposal.author_id)} proposes`} {proposalText(proposal, memberName)}
      </p>
      <p className="text-[12px] text-[#5C4A0B]">{stamp(proposal.created_at)}</p>
      {mine ? (
        <p className="mt-1.5 text-sm text-ink">Waiting for an answer.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => answer("accept")}
              className="h-11 flex-1 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCountering((c) => !c)}
              aria-expanded={countering}
              className="h-11 flex-1 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
            >
              Counter
            </button>
            {iAmRequester && (
              <button
                type="button"
                disabled={busy}
                onClick={() => answer("persist")}
                className="h-11 w-full rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
              >
                Keep Original Amount
              </button>
            )}
          </div>
          {countering && (
            <AmountForm
              disputeId={disputeId}
              fieldLabel="Your counter amount"
              submitLabel="Send Counter"
              onDone={() => {
                setCountering(false);
                onChanged();
              }}
            />
          )}
        </>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-warn">
          {problem}
        </p>
      )}
    </div>
  );
}

/** An amount in dollars: positive, whole cents, up to $10,000. Sent as a proposal (a retry reuses its id). */
function AmountForm({
  disputeId,
  fieldLabel,
  submitLabel,
  onDone,
}: {
  disputeId: string;
  fieldLabel: string;
  submitLabel: string;
  onDone: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useRef<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseCents(text);
    if (cents === null) return setProblem("Enter an amount like 25 or 25.50 (no fractions of a cent).");
    if (cents < 1 || cents > TOTAL_MAX_CENTS) return setProblem("Enter an amount between $0.01 and $10,000.");
    setBusy(true);
    setProblem(null);
    id.current ??= crypto.randomUUID();
    const { error } = await supabase.rpc("propose_dispute_change", {
      prop_id: id.current,
      target: disputeId,
      proposal_kind: "amount",
      amount: cents,
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    id.current = null;
    setText("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2" noValidate>
      <label className="flex flex-col gap-1 text-[13px] font-bold">
        {fieldLabel}
        <span className="flex h-11 items-center rounded-xl border border-line bg-white px-3 focus-within:border-brand">
          <span className="text-muted">$</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              id.current = null;
            }}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={problem ? true : undefined}
            className="w-full bg-transparent pl-1 text-base font-normal outline-none"
          />
        </span>
      </label>
      {problem && (
        <p role="alert" className="text-[13px] font-semibold text-warn">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {busy ? "Sending…" : submitLabel}
      </button>
    </form>
  );
}

/** The member only: propose paying nothing for this request. */
function ProposeCancel({ disputeId, onChanged }: { disputeId: string; onChanged: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useRef<string | null>(null);

  async function send() {
    setBusy(true);
    setProblem(null);
    id.current ??= crypto.randomUUID();
    const { error } = await supabase.rpc("propose_dispute_change", { prop_id: id.current, target: disputeId, proposal_kind: "cancel" });
    setBusy(false);
    if (error) return setProblem(error.message);
    id.current = null;
    setAsking(false);
    onChanged();
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      {!asking ? (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="h-11 w-full rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
        >
          Propose Canceling My Payment
        </button>
      ) : (
        <div className="rounded-xl bg-mist p-3">
          <p className="text-sm text-ink">Propose that you don&apos;t pay anything for this request?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={send}
              className="h-11 flex-1 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send Proposal"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setAsking(false)}
              className="h-11 flex-1 rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-[13px] font-semibold text-warn">
          {problem}
        </p>
      )}
    </div>
  );
}
