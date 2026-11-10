"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { createClient } from "@/lib/supabase/client";
import { dollars, parseCents, stamp, TOTAL_MAX_CENTS, type DisputeProposal, type PaymentDispute } from "../../../requests";

// The private dispute chat inside a request's Details page. Only the requester and the
// disputing member get anything back from the database (everyone else sees nothing here).
// The requester sees each person disputing and picks whom to talk with; the member sees
// their own dispute. Shows the original amount, the reason, messages, the open proposal
// and past decisions. Accepting changes the share in the database, never here.

type Person = { user_id: string; first_name: string; last_name: string };

/** Ask the panel to open a chat: with this member (requester), or your own (member: null). */
export type ChatFocus = { user: string | null; n: number };

export default function DisputePanel({
  requestId,
  me,
  payee,
  focus,
  onChanged,
}: {
  requestId: string;
  me: string;
  payee: Person | null;
  focus: ChatFocus | null;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [disputes, setDisputes] = useState<PaymentDispute[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [seenFocus, setSeenFocus] = useState(0);
  const [scrollKey, setScrollKey] = useState(0);
  const fromForm = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_payment_disputes", { req: requestId });
    if (error) return;
    const list = (data ?? []) as PaymentDispute[];
    setDisputes(list);
    // Arrived from the Dispute form (…#dispute): open the new chat once.
    if (!fromForm.current && window.location.hash === "#dispute") {
      fromForm.current = true;
      const first = list.find((d) => d.status === "open") ?? list[0];
      if (first) {
        setOpenId(first.id);
        setScrollKey((k) => k + 1);
      }
    }
  }, [supabase, requestId]);

  // Live: messages, proposals and answers from the other side. The database only sends
  // rows this person may see.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`disputes-${requestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_disputes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispute_messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispute_proposals" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, requestId, load]);

  // "Open Dispute Chat" elsewhere on the page: open that chat (their open dispute first).
  if (focus && disputes && focus.n !== seenFocus) {
    setSeenFocus(focus.n);
    const mine = disputes.filter((d) => focus.user === null || d.member.user_id === focus.user);
    const target = mine.find((d) => d.status === "open") ?? mine[0];
    if (target) {
      setOpenId(target.id);
      setScrollKey((k) => k + 1);
    }
  }

  useEffect(() => {
    if (scrollKey && openId) document.getElementById(`dispute-${openId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollKey, openId]);

  if (!disputes?.length) return null;

  const iAmRequester = payee?.user_id === me;
  const openCount = disputes.filter((d) => d.status === "open").length;
  const other = (d: PaymentDispute): Person =>
    iAmRequester ? d.member : (payee ?? { user_id: "", first_name: "the requester", last_name: "" });

  return (
    <section id="dispute" className="scroll-mt-4 rounded-3xl border border-line bg-white p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-extrabold">{iAmRequester ? "Disputes" : "Your dispute"}</h3>
        <p className="text-sm text-muted">{openCount ? `${openCount} open` : "None open"}</p>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {iAmRequester
          ? "Open a chat to talk it through, propose a new amount, or answer their proposal."
          : "Open the chat to talk with the requester and propose a new amount or canceling your payment."}
      </p>

      <ul className="mt-3 flex flex-col gap-2" aria-label="Disputes">
        {disputes.map((d) => {
          const isOpenChat = d.id === openId;
          const label = iAmRequester ? `${d.member.first_name} ${d.member.last_name}` : `Opened ${stamp(d.created_at)}`;
          return (
            <li
              key={d.id}
              id={`dispute-${d.id}`}
              className={`scroll-mt-4 rounded-2xl border ${isOpenChat ? "border-brand" : "border-line"}`}
            >
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                {iAmRequester && (
                  <Avatar
                    src={d.member.avatar_url}
                    name={`${d.member.first_name} ${d.member.last_name}`}
                    seed={d.member.user_id}
                    size={36}
                  />
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{label}</span>
                  <span className="text-[13px] text-muted">
                    {d.status === "open"
                      ? `Disputing ${dollars(d.original_cents)}`
                      : d.resolution === "waived"
                        ? "Payment canceled"
                        : `Changed to ${dollars(d.final_cents ?? 0)}`}
                  </span>
                </span>
                <StatusChip dispute={d} />
                <button
                  type="button"
                  onClick={() => setOpenId(isOpenChat ? null : d.id)}
                  aria-expanded={isOpenChat}
                  className={`h-11 shrink-0 rounded-xl px-4 text-sm font-bold ${
                    isOpenChat ? "border border-line bg-white text-ink hover:bg-mist" : "bg-brand text-white hover:bg-brand-hover"
                  }`}
                >
                  {isOpenChat ? "Close Chat" : "Open Dispute Chat"}
                </button>
              </div>
              {isOpenChat && (
                <div className="border-t border-line px-3 pb-3 sm:px-4">
                  <Thread dispute={d} me={me} other={other(d)} iAmRequester={iAmRequester} onChanged={() => (load(), onChanged())} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StatusChip({ dispute }: { dispute: PaymentDispute }) {
  return dispute.status === "open" ? (
    <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 text-xs font-bold text-honey">Open</span>
  ) : (
    <span className="shrink-0 rounded-full bg-tint px-2.5 py-0.5 text-xs font-bold text-brand">Resolved</span>
  );
}

/* ---------- One dispute ---------- */

type Item =
  { at: string; kind: "message"; id: string; author: string | null; body: string } | { at: string; kind: "note"; id: string; text: string };

function Thread({
  dispute,
  me,
  other,
  iAmRequester,
  onChanged,
}: {
  dispute: PaymentDispute;
  me: string;
  other: Person;
  iAmRequester: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const member = dispute.member;
  const isOpen = dispute.status === "open";
  const open = dispute.proposals.find((p) => p.status === "open") ?? null;
  const who = (id: string | null) =>
    id === me ? "You" : id === member.user_id ? member.first_name : id === other.user_id ? other.first_name : "Someone";

  // Messages, proposals and decisions in time order.
  const items = useMemo(() => {
    const list: Item[] = dispute.messages.map((m) => ({ at: m.created_at, kind: "message", id: m.id, author: m.author_id, body: m.body }));
    dispute.proposals.forEach((p, i) => {
      const before = dispute.proposals[i - 1];
      const verb =
        before?.status === "countered" && before.decided_by === p.author_id
          ? "countered with"
          : before?.status === "replaced" && before.author_id === p.author_id
            ? "changed their proposal to"
            : "proposed";
      list.push({
        at: p.created_at,
        kind: "note",
        id: `p-${p.id}`,
        text: `${who(p.author_id)} ${verb} ${proposalText(p, who(member.user_id))}.`,
      });
      if (p.status === "accepted" && p.decided_at) {
        list.push({
          at: p.decided_at,
          kind: "note",
          id: `a-${p.id}`,
          text:
            p.kind === "amount"
              ? `${who(p.decided_by)} accepted ${dollars(p.amount_cents ?? 0)}. The share is now ${dollars(p.amount_cents ?? 0)} and goes back to Pending until ${member.user_id === me ? "you confirm" : `${member.first_name} confirms`} it.`
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `who` only depends on these
  }, [dispute, me, other.user_id]);

  const end = useRef<HTMLDivElement>(null);
  const count = items.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [count]);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-bold">
          {iAmRequester ? `With ${member.first_name} ${member.last_name}` : `With ${other.first_name} ${other.last_name}`.trim()}
        </p>
        <StatusChip dispute={dispute} />
      </div>
      <p className="mt-1 text-[13px] text-muted">Private: only you and {other.first_name} can see this chat.</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-mist px-3 py-2">
          <dt className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">Original amount</dt>
          <dd className="font-extrabold">{dollars(dispute.original_cents)}</dd>
        </div>
        <div className="rounded-xl bg-mist px-3 py-2">
          <dt className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">{isOpen ? "Status" : "Outcome"}</dt>
          <dd className="font-extrabold">
            {isOpen
              ? "In dispute"
              : dispute.resolution === "waived"
                ? "Payment canceled"
                : `Changed to ${dollars(dispute.final_cents ?? 0)}`}
          </dd>
        </div>
      </dl>

      <div className="mt-3 rounded-2xl border border-line bg-butter px-4 py-3">
        <p className="text-[11px] font-bold tracking-[0.12em] text-honey uppercase">
          {member.user_id === me ? "Your reason" : `${member.first_name}'s reason`} · {stamp(dispute.created_at)}
        </p>
        <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{dispute.reason}</p>
      </div>

      <ol className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto" aria-label="Dispute chat">
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
                className={`mt-0.5 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                  item.author === me ? "bg-tint text-ink" : "border border-line bg-white text-ink"
                }`}
              >
                {item.body}
              </span>
            </li>
          ),
        )}
        <div ref={end} />
      </ol>

      {isOpen && (
        <>
          {open && (
            <OpenProposal
              disputeId={dispute.id}
              proposal={open}
              me={me}
              iAmRequester={iAmRequester}
              who={who}
              memberName={who(member.user_id)}
              onChanged={onChanged}
            />
          )}
          <ProposeTools disputeId={dispute.id} hasOwnOpen={open?.author_id === me} canCancel={!iAmRequester} onChanged={onChanged} />
        </>
      )}

      <Composer disputeId={dispute.id} supabase={supabase} onSent={onChanged} />
    </div>
  );
}

function proposalText(p: DisputeProposal, memberName: string) {
  if (p.kind === "cancel") return memberName === "You" ? "canceling your payment" : `canceling ${memberName}'s payment`;
  return dollars(p.amount_cents ?? 0);
}

/* ---------- The open proposal and its answers ---------- */

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
  who: (id: string | null) => string;
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
    <div className="mt-3 rounded-2xl border border-line bg-butter-strong px-4 py-3">
      <p className="text-[11px] font-bold tracking-[0.12em] text-[#5C4A0B] uppercase">Current proposal</p>
      <p className="mt-1 font-extrabold">
        {mine ? "You propose" : `${who(proposal.author_id)} proposes`} {proposalText(proposal, memberName)}
      </p>
      {mine ? (
        <p className="mt-1 text-sm text-ink">Waiting for an answer. You can still chat below.</p>
      ) : (
        <>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => answer("accept")}
              className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCountering((c) => !c)}
              aria-expanded={countering}
              className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
            >
              Counter
            </button>
            {iAmRequester && (
              <button
                type="button"
                disabled={busy}
                onClick={() => answer("persist")}
                className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
              >
                Keep Original Amount
              </button>
            )}
          </div>
          {countering && (
            <AmountForm
              disputeId={disputeId}
              label="Your counter amount"
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

/* ---------- The member's proposals ---------- */

function ProposeTools({
  disputeId,
  hasOwnOpen,
  canCancel,
  onChanged,
}: {
  disputeId: string;
  hasOwnOpen: boolean;
  canCancel: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [mode, setMode] = useState<"none" | "amount" | "cancel">("none");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelId = useRef<string | null>(null);

  async function proposeCancel() {
    setBusy(true);
    setProblem(null);
    cancelId.current ??= crypto.randomUUID();
    const { error } = await supabase.rpc("propose_dispute_change", {
      prop_id: cancelId.current,
      target: disputeId,
      proposal_kind: "cancel",
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    cancelId.current = null;
    setMode("none");
    onChanged();
  }

  return (
    <div className="mt-3">
      {hasOwnOpen && mode === "none" && <p className="mb-2 text-[13px] text-muted">A new proposal replaces your current one.</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "amount" ? "none" : "amount"))}
          aria-expanded={mode === "amount"}
          className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
        >
          Propose New Amount
        </button>
        {canCancel && (
          <button
            type="button"
            onClick={() => setMode((m) => (m === "cancel" ? "none" : "cancel"))}
            aria-expanded={mode === "cancel"}
            className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
          >
            Propose Canceling
          </button>
        )}
      </div>
      {mode === "amount" && (
        <AmountForm
          disputeId={disputeId}
          label="Your proposed amount"
          submitLabel="Send Proposal"
          onDone={() => {
            setMode("none");
            onChanged();
          }}
        />
      )}
      {mode === "cancel" && (
        <div className="mt-2.5 rounded-xl bg-mist p-3">
          <p className="text-sm text-ink">Propose that you don&apos;t pay anything for this request?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={proposeCancel}
              className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send Proposal"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("none")}
              className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-60"
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

/** An amount in dollars: positive, whole cents, up to $10,000. Sent as a proposal. */
function AmountForm({
  disputeId,
  label,
  submitLabel,
  onDone,
}: {
  disputeId: string;
  label: string;
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
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-2.5 flex flex-wrap items-end gap-2" noValidate>
      <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[13px] font-bold">
        {label}
        <span className="flex h-11 items-center rounded-xl border border-line bg-white px-3 focus-within:border-brand">
          <span className="text-muted">$</span>
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              id.current = null;
            }}
            inputMode="decimal"
            autoFocus
            placeholder="0.00"
            aria-invalid={problem ? true : undefined}
            className="w-full bg-transparent pl-1 text-base font-normal outline-none"
          />
        </span>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {busy ? "Sending…" : submitLabel}
      </button>
      {problem && (
        <p role="alert" className="w-full text-[13px] font-semibold text-warn">
          {problem}
        </p>
      )}
    </form>
  );
}

/* ---------- Writing in the dispute chat ---------- */

function Composer({ disputeId, supabase, onSent }: { disputeId: string; supabase: ReturnType<typeof createClient>; onSent: () => void }) {
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
    <form onSubmit={send} className="mt-3">
      <div className="flex items-end gap-2">
        <label htmlFor={`dispute-msg-${disputeId}`} className="sr-only">
          Message
        </label>
        <textarea
          id={`dispute-msg-${disputeId}`}
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
          className="min-h-11 flex-1 resize-none rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
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
