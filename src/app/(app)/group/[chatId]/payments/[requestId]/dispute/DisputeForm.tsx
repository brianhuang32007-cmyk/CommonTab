"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { detailsHref, disputeRoomHref, dollars, SHARE_STATUS, type PaymentRequestDetails } from "../../../../requests";
import { disputeFor, useMyDisputes } from "../DisputePanel";

// Starting a dispute: shows your current share, asks for a short reason, then Cancel or
// Submit Dispute. Only a Pending or Confirmed share can be disputed, one open dispute at a
// time. If submitting fails, the reason stays and you can try again (same id, so a retry
// can't open two). After it's sent, the private dispute chat opens on the Details page.

const REASON_MAX = 500;

export default function DisputeForm() {
  const { chatId, requestId } = useParams<{ chatId: string; requestId: string }>();
  const { id: me } = useProfile();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [request, setRequest] = useState<PaymentRequestDetails | null | "error" | "loading">("loading");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const disputeId = useRef<string | null>(null);
  const details = detailsHref(chatId, requestId);
  const { disputes } = useMyDisputes(requestId);
  const openDispute = disputeFor(disputes, me);

  useEffect(() => {
    let live = true;
    supabase.rpc("payment_request_details", { req: requestId }).then(({ data, error }) => {
      if (live) setRequest(error ? "error" : ((data as PaymentRequestDetails | null) ?? null));
    });
    return () => {
      live = false;
    };
  }, [supabase, requestId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = reason.trim();
    if (!clean) return setProblem("Write a short reason so they know what's wrong.");
    if (clean.length > REASON_MAX) return setProblem(`Keep the reason under ${REASON_MAX} characters.`);
    setBusy(true);
    setProblem(null);
    disputeId.current ??= crypto.randomUUID();
    const { error } = await supabase.rpc("open_payment_dispute", { new_id: disputeId.current, req: requestId, dispute_reason: clean });
    if (error) {
      setBusy(false);
      return setProblem(`${error.message.replace(/\.$/, "")}. Your reason is still here; try again.`);
    }
    router.push(disputeRoomHref(chatId, requestId, disputeId.current));
  }

  const shell = (body: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[560px] pb-10">
      <Link href={details} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to the request
      </Link>
      <section className="mt-2 rounded-3xl border border-line bg-white p-6 sm:p-7">{body}</section>
    </div>
  );

  if (request === "loading") {
    return shell(
      <p role="status" className="text-center text-sm text-muted">
        Loading…
      </p>,
    );
  }
  if (request === "error" || request === null) {
    return shell(
      <p className="text-sm text-muted">
        {request === "error" ? "Couldn't load this request. Check your connection and try again." : "This request isn't available."}
      </p>,
    );
  }

  const inSplit = request.my_share_cents !== null && request.payee_id !== me;
  const status = request.my_share_status;
  const payeeName = request.payee ? request.payee.first_name : "the requester";

  if (!inSplit || !status)
    return shell(<p className="text-sm text-muted">You&apos;re not paying in this request, so there&apos;s nothing to dispute.</p>);
  if (status === "disputed") {
    return shell(
      <>
        <p className="font-bold">You already have an open dispute on this share.</p>
        <Link
          href={openDispute ? disputeRoomHref(chatId, requestId, openDispute.id) : details}
          className="mt-3 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
        >
          Open Dispute Chat
        </Link>
      </>,
    );
  }
  if (status !== "pending" && status !== "confirmed") {
    return shell(
      <p className="text-sm text-muted">Only a Pending or Confirmed share can be disputed. Yours is {SHARE_STATUS[status].label}.</p>,
    );
  }

  return shell(
    <form onSubmit={submit} noValidate>
      <h2 className="text-[26px] leading-tight font-extrabold tracking-tight">Dispute Your Share</h2>
      <p className="mt-1 text-sm text-muted">{request.title}</p>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-mist px-4 py-3">
        <span className="text-sm font-bold">Your current share</span>
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${SHARE_STATUS[status].className}`}>
            {SHARE_STATUS[status].label}
          </span>
          <span className="text-xl font-extrabold">{dollars(request.my_share_cents ?? 0)}</span>
        </span>
      </div>
      {status === "confirmed" && (
        <p className="mt-2 text-[13px] text-muted">
          You confirmed this share. Your confirmation stays in the history, but you&apos;ll confirm again before paying.
        </p>
      )}

      <label htmlFor="dispute-reason" className="mt-4 block text-sm font-bold">
        Reason
      </label>
      <textarea
        id="dispute-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={REASON_MAX}
        rows={4}
        autoFocus
        placeholder={`Tell ${payeeName} what's wrong, e.g. "I left before dessert, so my share should be lower."`}
        aria-invalid={problem ? true : undefined}
        aria-describedby="dispute-reason-help"
        className="mt-1.5 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-base outline-none focus:border-brand"
      />
      <p id="dispute-reason-help" className="mt-1 flex justify-between text-[12px] text-muted">
        <span>Only you and {payeeName} can see this.</span>
        <span>
          {reason.length}/{REASON_MAX}
        </span>
      </p>
      {problem && (
        <p role="alert" className="mt-2 text-sm font-semibold text-warn">
          {problem}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <Link
          href={details}
          className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line bg-white font-bold text-ink hover:bg-mist"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={busy}
          className="h-12 flex-1 rounded-xl bg-brand font-bold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? "Submitting…" : "Submit Dispute"}
        </button>
      </div>
    </form>,
  );
}
