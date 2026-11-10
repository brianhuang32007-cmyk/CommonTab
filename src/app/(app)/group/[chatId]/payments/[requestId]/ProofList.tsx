"use client";

import { useEffect, useMemo, useState } from "react";
import { BoltIcon, CheckIcon, FileIcon } from "@/components/app/icons";
import { signedLinks } from "@/lib/signedLinks";
import { createClient } from "@/lib/supabase/client";
import { CHECK_ACCOUNT, dollars, PAY_METHOD_LABEL, stamp, type PaymentAiCheck, type PaymentProof } from "../../../requests";

// "I paid" submissions on a payment request: who paid, how, when, the screenshots and where
// each one stands (Waiting for review, Approved, Rejected with the reason). The requester
// approves or rejects the ones waiting; the payer sees the decision. Only those two people
// ever see a proof (the database and storage both check).

const REASON_MAX = 300;

const STATUS: Record<PaymentProof["status"], { label: string; className: string }> = {
  submitted: { label: "Waiting for review", className: "bg-butter-strong text-[#5C4A0B]" },
  approved: { label: "Approved", className: "bg-brand text-white" },
  // No red for money states.
  rejected: { label: "Rejected", className: "bg-butter text-honey" },
};

export default function ProofList({
  proofs,
  me,
  canReview,
  onChanged,
}: {
  proofs: PaymentProof[];
  me: string;
  /** The requester: Approve and Reject on proofs waiting for review. */
  canReview: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<Map<string, string>>(new Map());
  const paths = proofs.flatMap((p) => p.files.map((f) => f.path)).join("|");
  useEffect(() => {
    if (!paths) return;
    let live = true;
    signedLinks(supabase, "payment-proofs", paths.split("|")).then((m) => live && setLinks(m));
    return () => {
      live = false;
    };
  }, [supabase, paths]);

  return (
    <ul className="mt-3 flex flex-col gap-3">
      {proofs.map((p) => (
        <ProofItem key={p.id} proof={p} me={me} links={links} canReview={canReview && p.status === "submitted"} onChanged={onChanged} />
      ))}
    </ul>
  );
}

function ProofItem({
  proof: p,
  me,
  links,
  canReview,
  onChanged,
}: {
  proof: PaymentProof;
  me: string;
  links: Map<string, string>;
  canReview: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const st = STATUS[p.status];

  async function aiCheck() {
    setChecking(true);
    setProblem(null);
    const res = await fetch("/api/ai/payment-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proof_id: p.id }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
    setChecking(false);
    if (res?.ok) onChanged();
    else setProblem(body.error ?? "The AI couldn't check this right now. Check it by hand.");
  }
  const who = p.payer_id === me ? "You" : [p.first_name, p.last_name].filter(Boolean).join(" ") || "Someone";
  const check = CHECK_ACCOUNT[p.method];

  async function review(decision: "approve" | "reject") {
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("review_payment_proof", { target: p.id, decision, reason: decision === "reject" ? reason.trim() : null });
    setBusy(false);
    if (error) setProblem(error.message);
    else {
      setRejecting(false);
      onChanged();
    }
  }

  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-bold">
          {who} paid {dollars(p.amount_cents)} with {PAY_METHOD_LABEL[p.method]}
          <span className="block text-[13px] font-medium text-muted">Submitted {stamp(p.created_at)}</span>
        </p>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${st.className}`}>{st.label}</span>
      </div>
      {p.note && <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-sm whitespace-pre-wrap text-ink">{p.note}</p>}

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Screenshots">
        {p.files.map((f) => {
          const url = links.get(f.path);
          const image = f.mime_type.startsWith("image/") && !/hei[cf]/.test(f.mime_type);
          return (
            <a
              key={f.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${f.name}`}
              className="block overflow-hidden rounded-xl border border-line bg-mist hover:opacity-90"
            >
              {image && url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link
                <img src={url} alt={f.name} className="h-36 w-36 object-cover" />
              ) : (
                <span className="flex h-36 w-36 flex-col items-center justify-center gap-1.5 px-2 text-center text-[12px] text-muted">
                  <FileIcon className="h-6 w-6 text-brand" />
                  <span className="line-clamp-2 break-all">{url ? f.name : "Loading…"}</span>
                </span>
              )}
            </a>
          );
        })}
      </div>

      {p.ai_result && p.ai_status ? (
        <AiPaymentResult check={p.ai_result} ok={p.ai_status === "verified"} method={PAY_METHOD_LABEL[p.method]} />
      ) : (
        p.status === "submitted" && (
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
            <BoltIcon className="h-3.5 w-3.5 text-brand" />
            {checking ? "CommonTab AI is checking the screenshot…" : "No AI check yet."}
          </p>
        )
      )}
      {p.status === "submitted" && (
        <button
          type="button"
          disabled={checking}
          onClick={aiCheck}
          className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-bold text-ink hover:bg-tint disabled:opacity-50"
        >
          <BoltIcon className="h-4 w-4 text-brand" />
          {checking ? "Checking…" : p.ai_status ? "Check Again" : "Run AI Check"}
        </button>
      )}

      {p.status === "rejected" && p.review_reason && (
        <div className="mt-3 rounded-xl bg-butter px-3.5 py-2.5">
          <p className="text-sm font-bold text-honey">Rejected{p.reviewed_at ? ` · ${stamp(p.reviewed_at)}` : ""}</p>
          <p className="mt-0.5 text-sm text-ink">{p.review_reason}</p>
        </div>
      )}
      {p.status === "approved" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-brand">
          <CheckIcon className="h-4 w-4" />
          Approved{p.reviewed_at ? ` · ${stamp(p.reviewed_at)}` : ""}
        </p>
      )}

      {canReview && (
        <div className="mt-3 rounded-2xl bg-tint p-3.5">
          <p className="text-sm text-ink">
            Check that {dollars(p.amount_cents)} arrived in your {PAY_METHOD_LABEL[p.method]} before you approve it.{" "}
            {check.href ? (
              <a href={check.href} target="_blank" rel="noopener noreferrer" className="font-bold text-brand underline">
                {check.label}
              </a>
            ) : (
              <span className="font-bold">{check.label}.</span>
            )}
          </p>
          {!rejecting ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejecting(true)}
                className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
              >
                Reject
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => review("approve")}
                className="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                <CheckIcon className="h-4 w-4" />
                {busy ? "Saving…" : "Approve Payment"}
              </button>
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-butter p-3">
              <label className="flex flex-col gap-1.5">
                <span className="flex justify-between text-sm font-bold text-honey">
                  <span>Why are you rejecting it?</span>
                  <span className="font-medium">
                    {reason.length}/{REASON_MAX}
                  </span>
                </span>
                <textarea
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
                  rows={2}
                  placeholder="e.g. I don't see this payment in my Venmo. Can you send the full screenshot?"
                  className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none focus:border-brand"
                />
              </label>
              <p className="mt-1 text-[13px] text-ink">They&apos;ll see your reason and can send new proof.</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => review("reject")}
                  className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Reject Proof"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                  className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm font-semibold text-warn">
          {problem}
        </p>
      )}
    </li>
  );
}

/** What CommonTab AI read from the screenshot, next to what was owed. It never approves. */
function AiPaymentResult({ check, ok, method }: { check: PaymentAiCheck; ok: boolean; method: string }) {
  const rows = [
    { label: "Amount", value: check.amount_seen_cents !== null ? dollars(check.amount_seen_cents) : null, good: check.amount_seen_cents === check.owed_cents },
    { label: "Sent to", value: check.recipient_seen, good: null },
    { label: "App", value: check.app_seen ?? method, good: null },
    { label: "Date", value: check.date_seen, good: null },
    { label: "Status", value: check.completed === null ? null : check.completed ? "Completed" : "Not completed", good: check.completed },
    { label: "ID", value: check.transaction_id, good: null },
  ].filter((r) => r.value);
  return (
    <section aria-label="AI check" className={`mt-3 rounded-xl border ${ok ? "border-brand/30" : "border-[#E0C266]"}`}>
      <div className={`flex items-center gap-2 rounded-t-xl px-3.5 py-2.5 ${ok ? "bg-tint" : "bg-butter"}`}>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand text-white" : "bg-white text-honey"}`}>
          {ok ? <CheckIcon className="h-4 w-4" /> : <BoltIcon className="h-4 w-4" />}
        </span>
        <p className={`text-sm font-extrabold ${ok ? "text-brand" : "text-honey"}`}>
          {ok ? "AI check: matches what was owed" : "AI couldn't confirm it. Check it by hand."}
        </p>
      </div>
      <div className="px-3.5 py-2.5">
        <p className="text-sm text-ink">{check.reason}</p>
        {rows.length > 0 && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="font-bold text-muted">{r.label}</dt>
                <dd className={`break-words ${r.good === false ? "font-bold text-honey" : "text-ink"}`}>
                  {r.value}
                  {r.label === "Amount" && !r.good ? ` (owed ${dollars(check.owed_cents)})` : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-[12px] text-muted">An AI check, not proof. The person being paid checks their own account and decides.</p>
      </div>
    </section>
  );
}
