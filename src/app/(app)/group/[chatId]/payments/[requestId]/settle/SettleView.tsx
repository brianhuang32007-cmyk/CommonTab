"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CheckIcon, ChevronLeftIcon, CloseIcon, PaperclipIcon } from "@/components/app/icons";
import { PaymentLogo } from "@/components/app/PaymentLogos";
import { useProfile } from "@/components/app/ProfileContext";
import { paymentRef } from "@/lib/alerts";
import { formatUsPhone } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { storageName } from "../../../../documents";
import { uploadFile } from "../../../../messages";
import {
  detailsHref,
  dollars,
  dueLabel,
  PAY_METHOD_LABEL,
  paypalPayUrl,
  venmoPayUrl,
  type PayMethod,
  type PaymentProof,
  type PaymentRequestDetails,
} from "../../../../requests";
import ProofList from "../ProofList";

// Pay your share, for real, outside CommonTab (CommonTab never moves or holds money):
//   1. Choose how to pay: the methods the requester takes (their preferred one first).
//   2. Pay: Venmo and PayPal open with the amount filled in; for Zelle, copy their email or
//      phone and pay in your bank's app.
//   3. I Paid: pick the method, add a screenshot (you see a preview) and an optional note, and
//      submit it. Your share shows "Awaiting approval" until the requester approves it (Paid)
//      or rejects it with a reason (send new proof).

type Payee = NonNullable<PaymentRequestDetails["payee"]>;
const METHODS: PayMethod[] = ["venmo", "paypal", "zelle"];
const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
const PROOF_MAX = 10 * 1024 * 1024;
const PROOF_FILES = 3;

const handleOf = (payee: Payee, m: PayMethod) => (m === "venmo" ? payee.venmo_username : m === "paypal" ? payee.paypal_username : payee.zelle_contact);
const shown = (m: PayMethod, v: string) => (m === "venmo" ? `@${v.replace(/^@/, "")}` : m === "paypal" ? `paypal.me/${v}` : formatUsPhone(v));

export default function SettleView() {
  const { chatId, requestId } = useParams<{ chatId: string; requestId: string }>();
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [request, setRequest] = useState<PaymentRequestDetails | null | "error" | "loading">("loading");
  const [proofs, setProofs] = useState<PaymentProof[]>([]);

  const load = useCallback(async () => {
    const [details, mine] = await Promise.all([
      supabase.rpc("payment_request_details", { req: requestId }),
      supabase.rpc("my_payment_proofs", { req: requestId }),
    ]);
    setRequest(details.error ? "error" : ((details.data as PaymentRequestDetails | null) ?? null));
    if (!mine.error) setProofs((mine.data ?? []) as PaymentProof[]);
  }, [supabase, requestId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    // The requester approves or rejects while you're here.
    const channel = supabase
      .channel(`pay-${requestId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_proofs" }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 150);
      })
      // The request (or its chat) is deleted while this is open: reload, which shows it's gone.
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, () => {
        clearTimeout(timer);
        timer = setTimeout(load, 150);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, requestId, load]);

  const back = detailsHref(chatId, requestId);
  const shell = (body: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[620px] pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to the request
      </Link>
      <div className="mt-2 flex flex-col gap-4">{body}</div>
    </div>
  );

  if (request === "loading") {
    return shell(
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading…
      </p>,
    );
  }
  if (request === "error" || request === null || request.my_share_cents === null || !request.my_share_status || request.payee_id === me) {
    return shell(
      <section className="rounded-3xl border border-line bg-white p-6 text-sm text-muted">
        {request === "error"
          ? "Couldn't load this request. Check your connection and try again."
          : request === null
            ? "This request isn't available."
            : "You're not paying in this request, so there's nothing to pay."}
      </section>,
    );
  }

  const r = request;
  const status = r.my_share_status!;
  const payee = r.payee;
  const name = payee?.first_name ?? "the requester";
  const due = dueLabel(r.due_date);
  const latest = proofs[0] ?? null;

  return shell(
    <>
      {/* Your share */}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Pay your share</p>
        <h2 className="mt-1 text-[26px] leading-tight font-extrabold tracking-tight">{r.title}</h2>
        <p className="mt-1 text-sm text-muted">
          {paymentRef(r.id)} · <span className={due.overdue ? "rounded-full bg-butter px-2 py-0.5 font-bold text-honey" : ""}>{due.text}</span>
        </p>
        <p className="mt-3 flex items-baseline justify-between gap-3 text-lg font-bold">
          Your share <span className="text-3xl font-extrabold text-ink">{dollars(r.my_share_cents!)}</span>
        </p>
        {payee && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-mist p-3">
            <Avatar src={payee.avatar_url} name={`${payee.first_name} ${payee.last_name}`} seed={payee.user_id} size={40} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">
                Pay {payee.first_name} {payee.last_name}
              </span>
              <span className="block truncate text-[13px] text-muted">@{payee.username}</span>
            </span>
          </div>
        )}
      </section>

      {status === "pending" && <ConfirmFirst requestId={r.id} onDone={load} />}
      {status === "disputed" && <Note text={`Your share is in dispute. Work it out with ${name} before paying.`} tone="warn" />}
      {status === "waived" && <Note text={`${name} canceled your payment after your dispute. You don't owe anything.`} />}
      {status === "settled" && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <p className="flex items-center gap-2 text-lg font-extrabold text-brand">
            <CheckIcon className="h-5 w-5" />
            Paid
          </p>
          <p className="mt-1 text-sm text-muted">{name} approved your payment. Nothing more to do.</p>
        </section>
      )}
      {status === "marked_paid" && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <p className="text-lg font-extrabold">Awaiting approval</p>
          <p className="mt-1 text-sm text-muted">
            Your proof was sent. {name} will check their account and approve it. You&apos;ll get an alert either way.
          </p>
        </section>
      )}

      {status === "confirmed" && payee && (
        <PayAndProve request={r} payee={payee} me={me} rejected={latest?.status === "rejected" ? latest : null} onSubmitted={load} />
      )}

      {proofs.length > 0 && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <h3 className="text-lg font-extrabold">Your submissions</h3>
          <ProofList proofs={proofs} me={me} canReview={false} onChanged={load} />
        </section>
      )}
    </>,
  );
}

function Note({ text, tone = "muted" }: { text: string; tone?: "muted" | "warn" }) {
  return <p className={`rounded-3xl border border-line p-6 text-sm ${tone === "warn" ? "bg-butter text-ink" : "bg-white text-muted"}`}>{text}</p>;
}

function ConfirmFirst({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
      <p className="font-bold">Confirm your share first</p>
      <p className="mt-1 text-sm text-muted">Check the amount, then confirm it. After that you can pay.</p>
      {problem && <p className="mt-2 text-sm font-semibold text-warn">{problem}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await supabase.rpc("confirm_payment_share", { req: requestId });
          setBusy(false);
          if (error) setProblem(error.message);
          else onDone();
        }}
        className="mt-3 h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-60"
      >
        {busy ? "Confirming…" : "Confirm"}
      </button>
    </section>
  );
}

type Picked = { key: string; file: File; preview: string | null; path: string; status: "uploading" | "done" | "error"; error?: string };

function PayAndProve({
  request: r,
  payee,
  me,
  rejected,
  onSubmitted,
}: {
  request: PaymentRequestDetails;
  payee: Payee;
  me: string;
  rejected: PaymentProof | null;
  onSubmitted: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const offered = METHODS.filter((m) => handleOf(payee, m));
  const preferred = payee.preferred_handle && offered.includes(payee.preferred_handle) ? payee.preferred_handle : null;
  const ordered = [...offered].sort((a, b) => Number(b === preferred) - Number(a === preferred));
  const [method, setMethod] = useState<PayMethod | null>(ordered[0] ?? null);
  const [proving, setProving] = useState(Boolean(rejected));
  const [files, setFiles] = useState<Picked[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // A new id for each submission, so a double tap or a retry can't submit twice.
  const [proofId, setProofId] = useState(() => crypto.randomUUID());
  const counter = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const amount = r.my_share_cents ?? 0;
  const memo = `${r.title} (${paymentRef(r.id)})`;

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  function add(list: FileList | null) {
    if (!list) return;
    setProblem(null);
    for (const file of [...list].slice(0, PROOF_FILES - files.length)) {
      const type = file.type || (/\.hei[cf]$/i.test(file.name) ? "image/heic" : "");
      if (!PROOF_TYPES.includes(type)) {
        setProblem("Add a screenshot (JPG, PNG, WebP or HEIC) or a PDF.");
        continue;
      }
      if (file.size > PROOF_MAX) {
        setProblem(`${file.name} is too big (10 MB max).`);
        continue;
      }
      const key = crypto.randomUUID();
      const path = `${r.id}/${me}/${proofId}/${storageName(counter.current++, file.name)}`;
      const preview = type.startsWith("image/") && !/hei[cf]/.test(type) ? URL.createObjectURL(file) : null;
      setFiles((l) => [...l, { key, file, preview, path, status: "uploading" }]);
      uploadFile(supabase, "payment-proofs", path, file, type, "10 MB", () => {}).promise.then(
        () => setFiles((l) => l.map((f) => (f.key === key ? { ...f, status: "done" } : f))),
        (e: Error) => setFiles((l) => l.map((f) => (f.key === key ? { ...f, status: "error", error: e.message } : f))),
      );
    }
  }

  async function submit() {
    if (!method) return setProblem("Pick how you paid.");
    if (!files.length || files.some((f) => f.status !== "done")) return setProblem("Add a screenshot of your payment (and let it finish uploading).");
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("submit_payment_proof", {
      proof_id: proofId,
      req: r.id,
      pay_method: method,
      proof_note: note.trim() || null,
      files: files.map((f) => ({ path: f.path, name: f.file.name })),
    });
    setBusy(false);
    if (error) return setProblem(error.message);
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    const sent = proofId;
    setProofId(crypto.randomUUID());
    onSubmitted();
    // CommonTab AI checks the screenshot in the background; the result shows when it's ready.
    fetch("/api/ai/payment-proof", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proof_id: sent }) })
      .catch(() => null)
      .finally(onSubmitted);
  }

  if (!offered.length) {
    return (
      <Note
        text={`${payee.first_name} hasn't added a Venmo, PayPal or Zelle handle yet, so there's nowhere to pay. Ask them in the chat to add one in Preferences.`}
        tone="warn"
      />
    );
  }

  const handle = method ? handleOf(payee, method) : null;

  return (
    <>
      {rejected && (
        <div className="rounded-3xl bg-butter p-5">
          <p className="font-bold text-honey">{payee.first_name} rejected your last proof</p>
          {rejected.review_reason && <p className="mt-1 text-sm text-ink">{rejected.review_reason}</p>}
          <p className="mt-1 text-[13px] text-ink">Fix what they asked, then send new proof below.</p>
        </div>
      )}

      {/* 1 and 2: choose how, then pay outside CommonTab */}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <h3 className="text-lg font-extrabold">1. Choose how to pay</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Payment method">
          {ordered.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={`flex min-h-14 items-center gap-2.5 rounded-xl border px-3 text-left ${method === m ? "border-brand bg-tint" : "border-line bg-white hover:bg-mist"}`}
            >
              <PaymentLogo provider={m} className="h-7 w-7 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-bold">
                  {PAY_METHOD_LABEL[m]}
                  {m === preferred && <span className="font-medium text-muted"> · preferred</span>}
                </span>
                <span className="block truncate text-[12px] text-muted">{shown(m, handleOf(payee, m)!)}</span>
              </span>
            </button>
          ))}
        </div>

        {method && handle && (
          <div className="mt-5">
            <h3 className="text-lg font-extrabold">2. Pay {dollars(amount)}</h3>
            {method === "zelle" ? (
              <>
                <p className="mt-1 text-sm text-muted">Zelle has no link. Open your bank&apos;s app, choose Zelle, and send it to {payee.first_name}:</p>
                <ul className="mt-3 flex flex-col gap-2">
                  {[
                    { label: handle.includes("@") ? "Email" : "Phone", value: handle, text: shown("zelle", handle) },
                    { label: "Amount", value: (amount / 100).toFixed(2), text: dollars(amount) },
                    { label: "Memo", value: memo, text: memo },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                      <span className="w-16 shrink-0 text-[12px] font-bold text-muted uppercase">{row.label}</span>
                      <span className="min-w-0 flex-1 truncate font-bold">{row.text}</span>
                      <button
                        type="button"
                        onClick={() => copy(row.label, row.value)}
                        className="h-10 shrink-0 rounded-lg border border-line bg-white px-3 text-sm font-bold hover:bg-mist"
                      >
                        {copied === row.label ? "Copied" : "Copy"}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">
                  This opens {PAY_METHOD_LABEL[method]} with {dollars(amount)} to {shown(method, handle)} filled in
                  {method === "venmo" ? ", and a note saying what it's for" : ""}. Check it there before you send.
                </p>
                <a
                  href={method === "venmo" ? venmoPayUrl(handle, amount, memo) : paypalPayUrl(handle, amount)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover"
                >
                  Open {PAY_METHOD_LABEL[method]}
                </a>
              </>
            )}
          </div>
        )}
        <p className="mt-4 text-[12px] text-muted">The money goes straight from your account to {payee.first_name}&apos;s. CommonTab never holds it.</p>
      </section>

      {/* 3: I Paid, with proof */}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <h3 className="text-lg font-extrabold">3. Send proof</h3>
        {!proving ? (
          <>
            <p className="mt-1 text-sm text-muted">Once you&apos;ve paid, take a screenshot of the payment and tap I Paid.</p>
            <button type="button" onClick={() => setProving(true)} className="mt-3 h-12 w-full rounded-xl bg-ink px-5 font-bold text-white hover:bg-black">
              I Paid
            </button>
          </>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">How you paid</span>
              <select
                value={method ?? ""}
                onChange={(e) => setMethod((e.target.value || null) as PayMethod | null)}
                className="h-12 rounded-xl border border-line bg-white px-3 text-base"
              >
                {ordered.map((m) => (
                  <option key={m} value={m}>
                    {PAY_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>

            <input
              ref={input}
              type="file"
              multiple
              accept={PROOF_TYPES.join(",") + ",.heic,.heif"}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
            <div>
              <p className="text-sm font-bold">
                Screenshot <span className="text-warn">*</span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {files.map((f) => (
                  <div key={f.key} className="relative h-32 w-32 overflow-hidden rounded-xl border border-line bg-mist">
                    {f.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a local preview of the picked file
                      <img src={f.preview} alt={f.file.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center p-2 text-center text-[12px] break-all text-muted">{f.file.name}</span>
                    )}
                    <span
                      className={`absolute inset-x-0 bottom-0 px-2 py-0.5 text-[11px] font-bold ${
                        f.status === "done" ? "bg-brand text-white" : f.status === "error" ? "bg-butter text-honey" : "bg-white/90 text-ink"
                      }`}
                    >
                      {f.status === "done" ? "Uploaded" : f.status === "error" ? (f.error ?? "Failed") : "Uploading…"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (f.preview) URL.revokeObjectURL(f.preview);
                        setFiles((l) => l.filter((x) => x.key !== f.key));
                        if (f.status === "done") supabase.storage.from("payment-proofs").remove([f.path]);
                      }}
                      aria-label={`Remove ${f.file.name}`}
                      className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-ink"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                {files.length < PROOF_FILES && (
                  <button
                    type="button"
                    onClick={() => input.current?.click()}
                    className="flex h-32 w-32 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-brand/40 bg-tint text-sm font-bold text-brand hover:border-brand"
                  >
                    <PaperclipIcon className="h-5 w-5" />
                    Add Screenshot
                  </button>
                )}
              </div>
              <p className="mt-1 text-[12px] text-muted">Show the amount, who you paid and the date. Up to 3 images or PDFs, 10 MB each.</p>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">
                Note <span className="font-medium text-muted">· Optional</span>
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 300))}
                placeholder="e.g. Sent from my mom's Venmo"
                className="h-12 rounded-xl border border-line bg-white px-3.5 text-base outline-none focus:border-brand"
              />
            </label>

            {problem && (
              <p role="alert" className="rounded-xl bg-butter px-3.5 py-2.5 text-sm font-semibold text-honey">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setProving(false)}
                className="h-12 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !files.length || files.some((f) => f.status !== "done")}
                onClick={submit}
                className="h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                {busy ? "Sending…" : "Submit for Review"}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
