"use client";

import Link from "next/link";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import { CheckIcon, ChevronLeftIcon } from "@/components/app/icons";
import { PaymentLogo } from "@/components/app/PaymentLogos";
import { formatUsPhone } from "@/lib/profile";
import { dollars, PAY_METHOD_LABEL, stamp, type PayMethod, type PaymentRequestDetails, type PaymentTransfer } from "../../../../requests";

// The Settle screen: a SIMULATED payment. No real money moves and no outside app opens;
// every payment is accepted. Steps:
//   1. Choose a payment method (the recipient's available Venmo / PayPal / Zelle).
//   2. Add payment details (your own demo handle for that method, if you haven't added one).
//   3. Review and authorize (amount, recipient's handle, your handle, a note) → Confirm Demo Payment.
//   4. Processing (a progress bar with random pauses, 3 to 7 seconds), then Payment Complete
//      with a receipt (method, amount, recipient, transaction ID, time).
// Pure UI: the real page passes database calls in, the local demo passes made-up ones.
// Once a payment is sent it can't be sent again (the button locks and the receipt shows).

type Payee = NonNullable<PaymentRequestDetails["payee"]>;
type Status = NonNullable<PaymentRequestDetails["my_share_status"]>;
export type PayResult = { ok: true; transfer: PaymentTransfer } | { ok: false; message: string };
export type PayerHandles = Record<PayMethod, string | null>;
export type PayDetails = { payerHandle: string; note: string };

const METHODS: PayMethod[] = ["venmo", "paypal", "zelle"];

/** The recipient's handle for a method, as shown. */
function recipientHandle(payee: Payee | null, m: PayMethod) {
  if (!payee) return null;
  if (m === "venmo") return payee.venmo_username ? `@${payee.venmo_username}` : null;
  if (m === "paypal") return payee.paypal_username ? `paypal.me/${payee.paypal_username}` : null;
  return payee.zelle_contact ? formatUsPhone(payee.zelle_contact) : null;
}

/** Your demo handle: Venmo username, PayPal email, or Zelle email or US phone. Returns an error or null. */
function checkHandle(m: PayMethod, value: string): string | null {
  const v = value.trim();
  if (!v) return `Enter your ${FIELD[m].label.toLowerCase()}.`;
  if (m === "venmo") return /^@?[A-Za-z0-9_-]{5,30}$/.test(v) ? null : "Venmo usernames are 5 to 30 letters, numbers, - or _.";
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  if (m === "paypal") return email ? null : "Enter the email on your PayPal account.";
  const phone = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length === 10;
  return email || phone ? null : "Enter the email or US phone number you use for Zelle.";
}

function showHandle(m: PayMethod, v: string) {
  const t = v.trim();
  if (m === "venmo") return `@${t.replace(/^@/, "")}`;
  if (m === "zelle" && !t.includes("@")) {
    const d = t.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : t;
  }
  return t;
}

const FIELD: Record<PayMethod, { label: string; placeholder: string; inputMode: "text" | "email" }> = {
  venmo: { label: "Venmo username", placeholder: "@your-name", inputMode: "text" },
  paypal: { label: "PayPal email", placeholder: "you@example.com", inputMode: "email" },
  zelle: { label: "Zelle email or phone", placeholder: "you@example.com or (555) 123-4567", inputMode: "text" },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function SettlePanel({
  title,
  shareCents,
  status,
  payee,
  payerHandles,
  paid,
  backHref,
  chatHref,
  onConfirm,
  onPay,
}: {
  title: string;
  shareCents: number;
  status: Status;
  payee: Payee | null;
  /** Your own demo handles from your profile (null where you haven't added one). */
  payerHandles: PayerHandles;
  /** Your payment for this share, if you've already paid. */
  paid: PaymentTransfer | null;
  backHref: string;
  chatHref: string;
  onConfirm: () => Promise<string | null>;
  onPay: (method: PayMethod, details: PayDetails) => Promise<PayResult>;
}) {
  const available = METHODS.filter((m) => recipientHandle(payee, m));
  // If the recipient hasn't added any handles, the simulation still accepts all three.
  const choices = available.length ? available : METHODS;
  const preferred = payee?.preferred_handle && choices.includes(payee.preferred_handle) ? payee.preferred_handle : null;
  const ordered = [...choices].sort((a, b) => Number(b === preferred) - Number(a === preferred));

  const [step, setStep] = useState<"method" | "details" | "review" | "processing">("method");
  const [method, setMethod] = useState<PayMethod>(preferred ?? ordered[0]);
  const [handles, setHandles] = useState<PayerHandles>(payerHandles);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState(`CommonTab: ${title}`);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Starting…");
  const [done, setDone] = useState<{ transfer: PaymentTransfer; from: string; note: string } | null>(null);
  const payeeName = payee ? payee.first_name : "the requester";
  const payeeFull = payee ? `${payee.first_name} ${payee.last_name}` : "The requester";

  /* ---------- Payment Complete: the receipt ---------- */
  const receipt = done?.transfer ?? paid;
  if (receipt) {
    return (
      <section className="rounded-3xl border border-line bg-white p-6 text-center sm:p-8" aria-live="polite">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white">
          <CheckIcon className="h-8 w-8" />
        </span>
        <h2 className="mt-4 text-[28px] leading-tight font-extrabold tracking-tight">Payment Complete</h2>
        <p className="mt-1 text-sm text-muted">
          {dollars(receipt.amount_cents)} sent to {payeeFull} for {title}
        </p>
        <dl className="mx-auto mt-5 grid max-w-sm gap-2 text-left text-sm">
          <Row label="Amount" value={dollars(receipt.amount_cents)} />
          <Row label="Method" value={PAY_METHOD_LABEL[receipt.method]} />
          <Row
            label="Recipient"
            value={`${payeeFull}${recipientHandle(payee, receipt.method) ? ` · ${recipientHandle(payee, receipt.method)}` : ""}`}
          />
          {done && <Row label="From" value={done.from} />}
          <Row label="Transaction ID" value={receipt.confirmation} mono />
          <Row label="Time" value={stamp(receipt.created_at)} />
          {done?.note && <Row label="Note" value={done.note} />}
          <Row label="Share" value="Paid" />
        </dl>
        <p className="mx-auto mt-4 max-w-sm rounded-xl bg-mist px-3 py-2 text-[13px] text-muted">
          Simulated payment: no real money moved and no outside app opened. {payeeName === "the requester" ? "The requester" : payeeName}{" "}
          now sees your share as Paid.
        </p>
        <div className="mx-auto mt-5 flex max-w-sm gap-2">
          <Link
            href={backHref}
            className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line bg-white font-bold hover:bg-mist"
          >
            Back to Request
          </Link>
          <Link
            href={chatHref}
            className="flex h-12 flex-1 items-center justify-center rounded-xl bg-brand font-bold text-white hover:bg-brand-hover"
          >
            Back to Chat
          </Link>
        </div>
      </section>
    );
  }

  /* ---------- Not ready to pay yet ---------- */
  if (status !== "confirmed") {
    return (
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <h2 className="text-[26px] leading-tight font-extrabold tracking-tight">Settle Payment</h2>
        <p className="mt-1 text-sm text-muted">{title}</p>
        <p className="mt-4 flex items-baseline justify-between rounded-2xl bg-mist px-4 py-3">
          <span className="font-bold">Your share</span>
          <span className="text-2xl font-extrabold">{dollars(shareCents)}</span>
        </p>
        {status === "pending" ? (
          <>
            <p className="mt-4 rounded-2xl bg-citron px-4 py-3 text-sm text-ink">Confirm your share before paying.</p>
            {problem && (
              <p role="alert" className="mt-2 text-sm font-semibold text-warn">
                {problem}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setProblem(await onConfirm());
                setBusy(false);
              }}
              className="mt-4 h-12 w-full rounded-xl bg-brand font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </>
        ) : (
          <p className="mt-4 rounded-2xl bg-butter px-4 py-3 text-sm text-ink">
            {status === "disputed"
              ? `Your share is in dispute. Work it out with ${payeeName} before paying.`
              : status === "waived"
                ? `${payeeName} canceled your payment. You don't owe anything.`
                : "This share is already paid."}
          </p>
        )}
        <Link
          href={backHref}
          className="mt-3 flex h-12 items-center justify-center rounded-xl border border-line bg-white font-bold hover:bg-mist"
        >
          Back to Request
        </Link>
      </section>
    );
  }

  const myHandle = handles[method];
  const stepNumber = { method: 1, details: 2, review: 3, processing: 4 }[step];

  // Move on from choosing a method: add your details first if you haven't for this method.
  function chooseMethod() {
    setProblem(null);
    if (handles[method]) setStep("review");
    else {
      setDraft("");
      setStep("details");
    }
  }

  // The simulated processing: a progress bar that moves in bursts with random pauses for a
  // random 3 to 7 seconds, then records the payment. Nothing outside CommonTab is contacted.
  async function process() {
    if (busy || !myHandle) return;
    setBusy(true);
    setProblem(null);
    setStep("processing");
    setProgress(0);
    const total = 3000 + Math.random() * 4000;
    const started = Date.now();
    let at = 0;
    while (Date.now() - started < total) {
      if (Math.random() < 0.45) {
        setStage(at < 35 ? "Connecting…" : at < 75 ? "Authorizing payment…" : "Finalizing…");
        await sleep(300 + Math.random() * 900); // a pause
      } else {
        at = Math.min(92, at + 6 + Math.random() * 18);
        setProgress(at);
        setStage(at < 35 ? `Contacting ${PAY_METHOD_LABEL[method]} (simulated)…` : at < 75 ? "Authorizing payment…" : "Finalizing…");
        await sleep(200 + Math.random() * 350);
      }
    }
    const from = showHandle(method, myHandle);
    const result = await onPay(method, { payerHandle: from, note: note.trim() });
    if (!result.ok) {
      setBusy(false);
      setStep("review");
      setProblem(`${result.message.replace(/\.$/, "")}. Nothing was paid; try again.`);
      return;
    }
    setProgress(100);
    setStage("Payment complete");
    await sleep(500);
    setDone({ transfer: result.transfer, from, note: note.trim() });
  }

  return (
    <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[26px] leading-tight font-extrabold tracking-tight">Settle Payment</h2>
          <p className="mt-1 text-sm text-muted">{title}</p>
        </div>
        <span className="shrink-0 rounded-full bg-butter-strong px-2.5 py-1 text-[11px] font-bold text-[#5C4A0B]">Simulation</span>
      </div>

      {/* Steps */}
      <ol className="mt-4 grid grid-cols-4 gap-1.5" aria-label="Steps">
        {["Method", "Details", "Review", "Pay"].map((s, i) => (
          <li key={s} aria-current={stepNumber === i + 1 ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${stepNumber > i ? "bg-brand" : "bg-mist"}`} />
            <span className={`mt-1 block text-[11px] font-bold ${stepNumber === i + 1 ? "text-brand" : "text-muted"}`}>{s}</span>
          </li>
        ))}
      </ol>

      {/* Who and how much */}
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-mist px-4 py-3">
        {payee && <Avatar src={payee.avatar_url} name={payeeFull} seed={payee.user_id} size={44} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-muted">Your confirmed share to</span>
          <span className="block truncate font-bold">{payeeFull}</span>
        </span>
        <span className="text-[28px] font-extrabold">{dollars(shareCents)}</span>
      </div>

      {/* 1. Choose a payment method */}
      {step === "method" && (
        <>
          <fieldset className="mt-5">
            <legend className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Choose a payment method</legend>
            {!available.length && (
              <p className="mt-1 text-[13px] text-muted">{payeeName} hasn&apos;t added handles; the simulation accepts any method.</p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {ordered.map((m) => {
                const theirs = recipientHandle(payee, m);
                const active = method === m;
                return (
                  <label
                    key={m}
                    className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2 ${
                      active ? "border-brand bg-tint" : "border-line bg-white hover:bg-mist"
                    }`}
                  >
                    <input type="radio" name="pay-method" value={m} checked={active} onChange={() => setMethod(m)} className="sr-only" />
                    <PaymentLogo provider={m} className="h-8 w-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">
                        {PAY_METHOD_LABEL[m]}
                        {m === preferred && <span className="font-medium text-muted"> · preferred</span>}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        To {theirs ?? "(no handle on file)"} · {handles[m] ? `from ${showHandle(m, handles[m]!)}` : "add your details next"}
                      </span>
                    </span>
                    <span
                      aria-hidden
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-brand bg-brand text-white" : "border-line"}`}
                    >
                      {active && <CheckIcon className="h-3.5 w-3.5" />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={chooseMethod}
            className="mt-5 h-12 w-full rounded-xl bg-brand font-bold text-white hover:bg-brand-hover"
          >
            Continue
          </button>
          <Link href={backHref} className="mt-2 flex h-12 items-center justify-center rounded-xl font-bold text-brand hover:bg-mist">
            Cancel
          </Link>
        </>
      )}

      {/* 2. Add payment details */}
      {step === "details" && (
        <form
          className="mt-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const err = checkHandle(method, draft);
            if (err) return setProblem(err);
            setProblem(null);
            setHandles((h) => ({ ...h, [method]: draft.trim() }));
            setStep("review");
          }}
        >
          <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Add payment details</p>
          <p className="mt-1 text-sm text-muted">
            Add the demo {PAY_METHOD_LABEL[method]} account you&apos;re paying from. It&apos;s only used for this simulation.
          </p>
          <label htmlFor="payer-handle" className="mt-3 block text-sm font-bold">
            {FIELD[method].label}
          </label>
          <span className="mt-1.5 flex h-12 items-center gap-2 rounded-xl border border-line bg-white px-3 focus-within:border-brand">
            <PaymentLogo provider={method} className="h-6 w-6" />
            <input
              id="payer-handle"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              inputMode={FIELD[method].inputMode}
              autoComplete="off"
              autoFocus
              placeholder={FIELD[method].placeholder}
              aria-invalid={problem ? true : undefined}
              className="w-full bg-transparent text-base outline-none"
            />
          </span>
          {problem && (
            <p role="alert" className="mt-2 text-sm font-semibold text-warn">
              {problem}
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setProblem(null);
                setStep("method");
              }}
              className="flex h-12 flex-1 items-center justify-center gap-1 rounded-xl border border-line bg-white font-bold hover:bg-mist"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Back
            </button>
            <button type="submit" className="h-12 flex-1 rounded-xl bg-brand font-bold text-white hover:bg-brand-hover">
              Continue
            </button>
          </div>
        </form>
      )}

      {/* 3. Review and authorize */}
      {step === "review" && myHandle && (
        <div className="mt-5">
          <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Review and authorize</p>
          <dl className="mt-2 grid gap-2 text-sm">
            <Row label="Amount" value={dollars(shareCents)} strong />
            <Row label="Method" value={PAY_METHOD_LABEL[method]} />
            <Row label="To" value={`${payeeFull}${recipientHandle(payee, method) ? ` · ${recipientHandle(payee, method)}` : ""}`} />
            <div className="flex items-center justify-between gap-3 rounded-xl bg-mist px-3 py-2">
              <dt className="text-muted">From</dt>
              <dd className="flex items-center gap-2 font-bold">
                {showHandle(method, myHandle)}
                <button
                  type="button"
                  onClick={() => {
                    setDraft(myHandle);
                    setStep("details");
                  }}
                  className="text-[13px] font-bold text-brand underline"
                >
                  Change
                </button>
              </dd>
            </div>
          </dl>
          <label htmlFor="pay-note" className="mt-3 block text-sm font-bold">
            Payment note
          </label>
          <input
            id="pay-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={80}
            className="mt-1.5 h-12 w-full rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-brand"
          />
          <p className="mt-4 rounded-xl bg-butter-strong px-3 py-2 text-[13px] font-semibold text-[#5C4A0B]">
            Simulation: no real money moves and no outside app opens.
          </p>
          {problem && (
            <p role="alert" className="mt-2 text-sm font-semibold text-warn">
              {problem}
            </p>
          )}
          <button
            type="button"
            onClick={process}
            disabled={busy}
            className="mt-4 h-14 w-full rounded-xl bg-brand text-lg font-extrabold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            Confirm Demo Payment
          </button>
          <button
            type="button"
            onClick={() => setStep("method")}
            className="mt-2 flex h-12 w-full items-center justify-center gap-1 rounded-xl font-bold text-brand hover:bg-mist"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Change Method
          </button>
        </div>
      )}

      {/* 4. Processing */}
      {step === "processing" && (
        <div className="mt-6 pb-2 text-center" role="status" aria-live="polite">
          <p className="text-lg font-extrabold">Processing</p>
          <p className="mt-1 text-sm text-muted">{stage}</p>
          <div
            className="mt-4 h-3 overflow-hidden rounded-full bg-mist"
            role="progressbar"
            aria-label="Payment progress"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-leaf transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {dollars(shareCents)} to {payeeFull} via {PAY_METHOD_LABEL[method]}. Don&apos;t close this page.
          </p>
        </div>
      )}
    </section>
  );
}

function Row({ label, value, mono = false, strong = false }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-mist px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`text-right font-bold ${mono ? "font-mono tracking-wider" : ""} ${strong ? "text-lg font-extrabold" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
