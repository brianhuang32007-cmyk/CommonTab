"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { CameraIcon, CardIcon, ChevronLeftIcon, CloseIcon, PaperclipIcon, PlusIcon } from "@/components/app/icons";
import { shrinkPhoto, toBase64 } from "@/lib/photos";
import { createClient } from "@/lib/supabase/client";
import { uploadChatFile } from "../../../messages";
import {
  centsText,
  dollars,
  parseCents,
  parsePercent,
  percentText,
  splitByPercent,
  splitEvenly,
  todayIso,
  TOTAL_MAX_CENTS,
  type DigitalReceipt,
} from "../../../requests";
import { personName, type Conversation, type Member } from "../../../types";

// Request Payment (owner and organizers only). Title, total, due date, who pays, and an equal
// or custom split; plus an optional receipt photo the AI turns into a digital receipt for the
// requester to check. Sending saves the request and posts its card in the chat.
// Plain code does all the math; the database checks it again.

const TITLE_MAX = 80;
/** Equally (plain code), by amount (typed per person), or by percent (plain code turns them into cents). */
type Split = "equal" | "amount" | "percent";
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX = 10 * 1024 * 1024;

type Scan =
  | { status: "scanning"; file: File; preview: string }
  | { status: "ready"; file: File; preview: string; receipt: DigitalReceipt }
  | { status: "error"; file: File; preview: string; error: string };

export default function PaymentForm({ chat, me, chatTitle }: { chat: Conversation; me: string; chatTitle: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const back = `/group?chat=${chat.id}`;
  // Made once per form, so a retry can't create a second request.
  const [requestId] = useState(() => crypto.randomUUID());

  const others = useMemo(
    () => chat.members.filter((m) => m.user_id !== me).sort((a, b) => personName(a).localeCompare(personName(b))),
    [chat.members, me],
  );
  const self = chat.members.find((m) => m.user_id === me);

  const [title, setTitle] = useState("");
  const [totalText, setTotalText] = useState("");
  const [due, setDue] = useState("");
  // Starts empty: the requester adds people from the group (or everyone with Select All).
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [includeMe, setIncludeMe] = useState(false);
  const [split, setSplit] = useState<Split>("equal");
  const [custom, setCustom] = useState<Record<string, string>>({}); // By amount: "25.00"
  const [percents, setPercents] = useState<Record<string, string>>({}); // By percent: "33.34"
  const [scan, setScan] = useState<Scan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const attachInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // The photo preview is freed when it's replaced, removed, or you leave the page.
  const previewUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );
  function newPreview(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = file ? URL.createObjectURL(file) : null;
    return previewUrl.current;
  }

  /* ---------- The split (plain code) ---------- */

  // You first when you're included, so you take any extra cent.
  const people: Member[] = [...(includeMe && self ? [self] : []), ...others.filter((m) => picked[m.user_id])];
  const typedAmounts = people.map((m) => parseCents(custom[m.user_id] ?? "") ?? 0);
  const typedSum = typedAmounts.reduce((a, b) => a + b, 0);
  // By amount with no total typed: the total is whatever the amounts add up to.
  const totalAuto = split === "amount" && totalText.trim() === "";
  const total = totalAuto ? typedSum || null : parseCents(totalText);
  const evenly = total ? splitEvenly(total, people.length) : [];
  const bps = people.map((m) => parsePercent(percents[m.user_id] ?? "") ?? 0);
  const bpSum = bps.reduce((a, b) => a + b, 0);
  const amounts =
    split === "equal" ? people.map((_, i) => evenly[i] ?? 0) : split === "amount" ? typedAmounts : splitByPercent(total ?? 0, bps);
  const assigned = amounts.reduce((a, b) => a + b, 0);
  const left = (total ?? 0) - assigned;

  function chooseSplit(next: Split) {
    if (next === split) return;
    // Leaving "By amount" while the total was adding itself up: keep that total.
    if (totalAuto && typedSum) setTotalText(centsText(typedSum));
    // Start each custom split from the even split, so it already adds up.
    if (next === "amount" && total) setCustom(Object.fromEntries(people.map((m, i) => [m.user_id, centsText(evenly[i] ?? 0)])));
    if (next === "percent") {
      const even = splitEvenly(10000, people.length);
      setPercents(Object.fromEntries(people.map((m, i) => [m.user_id, percentText(even[i])])));
    }
    setSplit(next);
  }

  const problems = {
    title: !title.trim() ? "Add a title." : null,
    total:
      total === null
        ? totalAuto
          ? "Enter the total, or type each person's amount below."
          : "Enter the total, like 120.50."
        : total < 1 || total > TOTAL_MAX_CENTS
          ? "The total must be between $0.01 and $10,000."
          : null,
    due: due && due < todayIso() ? "The due date can't be in the past." : null,
    people: !people.some((m) => m.user_id !== me) ? "Pick at least one person to pay." : null,
    split:
      split === "amount"
        ? people.some((m) => custom[m.user_id] && parseCents(custom[m.user_id]) === null)
          ? "Each amount must be a number, like 25.00."
          : !totalAuto && total && left !== 0
            ? `The amounts must add up to ${dollars(total)} (${left > 0 ? `${dollars(left)} left` : `${dollars(-left)} over`}).`
            : null
        : split === "percent"
          ? people.some((m) => percents[m.user_id] && parsePercent(percents[m.user_id]) === null)
            ? "Each percentage must be a number from 0 to 100."
            : bpSum !== 10000
              ? `The percentages must add up to 100% (${bpSum < 10000 ? `${percentText(10000 - bpSum)}% left` : `${percentText(bpSum - 10000)}% over`}).`
              : null
          : null,
  };
  const firstProblem = Object.values(problems).find(Boolean) ?? null;

  /* ---------- Receipt: attach or take a photo, then the AI reads it ---------- */

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return setError("Receipts must be a JPG, PNG or WebP photo.");
    if (file.size > PHOTO_MAX) return setError("Photos must be 10 MB or smaller.");
    setError(null);
    const preview = scan?.file === file ? scan.preview : newPreview(file)!;
    setScan({ status: "scanning", file, preview });
    try {
      const data = await toBase64(await shrinkPhoto(file));
      const res = await fetch("/api/ai/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: { name: file.name, mediaType: "image/jpeg", data } }),
      });
      const json = (await res.json().catch(() => null)) as { receipt?: DigitalReceipt; error?: string } | null;
      if (!res.ok || !json?.receipt) throw new Error(json?.error ?? "Couldn't read that receipt. Fill in the total yourself.");
      const receipt = json.receipt;
      setScan({ status: "ready", file, preview, receipt });
      // Nothing typed yet: start from the receipt's total (you can still change it).
      if (!totalText && receipt.total_cents) setTotalText(centsText(receipt.total_cents));
    } catch (e) {
      setScan({ status: "error", file, preview, error: e instanceof Error ? e.message : "Couldn't read that receipt." });
    }
  }

  const editReceipt = (change: Partial<DigitalReceipt>) =>
    setScan((s) => (s && s.status === "ready" ? { ...s, receipt: { ...s.receipt, ...change } } : s));

  /* ---------- Send ---------- */

  async function send() {
    setTried(true);
    if (busy || firstProblem || total === null) return;
    setBusy(true);
    setError(null);
    try {
      // The receipt photo goes to the group's private files first (shrunk, as a JPEG).
      let receiptPath: string | null = null;
      if (scan) {
        receiptPath = `${chat.id}/${requestId}/receipt.jpg`;
        const jpeg = await shrinkPhoto(scan.file);
        await uploadChatFile(supabase, receiptPath, new File([jpeg], "receipt.jpg", { type: "image/jpeg" }), () => {}).promise;
      }
      const { error: saveError } = await supabase.rpc("create_payment_request", {
        req_id: requestId,
        target: chat.id,
        request_title: title.trim(),
        total,
        due: due || null,
        split_kind: split === "equal" ? "equal" : "custom",
        shares: people.map((m, i) => ({ user_id: m.user_id, amount_cents: amounts[i] })),
        receipt_file: receiptPath,
        receipt_data: scan?.status === "ready" ? scan.receipt : null,
      });
      if (saveError) throw new Error(saveError.message);
      router.push(back);
    } catch (e) {
      // Everything entered stays, so you can try again.
      setError(e instanceof Error ? e.message : "Couldn't send the request. Check your connection and try again.");
      setBusy(false);
    }
  }

  const show = (key: keyof typeof problems) => (tried ? problems[key] : null);

  return (
    <div className="mx-auto w-full max-w-[720px] pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {chatTitle}
      </Link>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mt-2 flex flex-col gap-5"
      >
        <fieldset disabled={busy} className="flex flex-col gap-5 disabled:opacity-70">
          {/* Heading and basics */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
                <CardIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[26px] font-extrabold tracking-tight">Request Payment</h2>
                <p className="truncate text-sm text-muted">In {chatTitle}</p>
              </div>
            </div>

            <Field label="Title" required error={show("title")} counter={`${title.length}/${TITLE_MAX}`}>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="e.g. Tahoe cabin"
                className={inputClass(Boolean(show("title")))}
              />
            </Field>

            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Total" required error={show("total")} hint={totalAuto ? "Adds up the amounts you type" : undefined}>
                <span className={`flex items-center ${inputClass(Boolean(show("total")))}`}>
                  <span className="text-muted">$</span>
                  <input
                    inputMode="decimal"
                    // By amount with no total typed, this shows the running sum; typing here sets it yourself.
                    value={totalAuto ? (typedSum ? centsText(typedSum) : "") : totalText}
                    onChange={(e) => setTotalText(e.target.value)}
                    placeholder="0.00"
                    aria-label="Total in dollars"
                    className="min-w-0 flex-1 bg-transparent pl-1 outline-none"
                  />
                </span>
              </Field>
              <Field label="Due date" error={show("due")} hint="Optional">
                <input
                  type="date"
                  min={todayIso()}
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className={inputClass(Boolean(show("due")))}
                />
              </Field>
            </div>
          </section>

          {/* Receipt */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="text-lg font-extrabold">Receipt</h3>
            <p className="mt-0.5 text-sm text-muted">
              Optional. CommonTab AI turns the photo into a clear digital receipt for you to check.
            </p>
            <input
              ref={attachInput}
              type="file"
              accept={PHOTO_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {/* On phones this opens the camera; on a computer it opens the file picker. */}
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                pickPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            {!scan ? (
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button type="button" onClick={() => attachInput.current?.click()} className={choiceClass}>
                  <PaperclipIcon className="h-5 w-5 text-brand" />
                  Attach a Photo
                </button>
                <button type="button" onClick={() => cameraInput.current?.click()} className={choiceClass}>
                  <CameraIcon className="h-5 w-5 text-brand" />
                  Take a Photo
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row">
                <div className="relative w-full shrink-0 sm:w-40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of your own photo */}
                  <img src={scan.preview} alt="Receipt photo" className="max-h-60 w-full rounded-2xl border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      newPreview(null);
                      setScan(null);
                    }}
                    aria-label="Remove the receipt"
                    className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow hover:bg-white"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  {scan.status === "scanning" && (
                    <p role="status" className="flex items-center gap-2 rounded-2xl bg-mist p-4 text-sm text-muted">
                      <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-sage" />
                      Reading the receipt…
                    </p>
                  )}
                  {scan.status === "error" && (
                    <div role="alert" className="rounded-2xl bg-butter p-4 text-sm">
                      <p className="font-bold text-honey">Couldn&apos;t read the receipt</p>
                      <p className="mt-1 text-ink">{scan.error}</p>
                      <button type="button" onClick={() => pickPhoto(scan.file)} className="mt-2 font-bold text-brand underline">
                        Try again
                      </button>
                    </div>
                  )}
                  {scan.status === "ready" && (
                    <DigitalReceiptEditor
                      receipt={scan.receipt}
                      onChange={editReceipt}
                      onUseTotal={(cents) => setTotalText(centsText(cents))}
                      total={total}
                    />
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Who pays and how it's split */}
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-extrabold">Who pays</h3>
                <p className="mt-0.5 text-sm text-muted">
                  Add the people who owe a share. They&apos;re tagged in the chat, and you get paid.
                </p>
              </div>
              <span role="radiogroup" aria-label="How to split" className="flex rounded-xl border border-line bg-mist p-1">
                {(
                  [
                    ["equal", "Equally"],
                    ["amount", "By amount"],
                    ["percent", "By percent"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={split === k}
                    onClick={() => chooseSplit(k)}
                    className={`h-9 rounded-lg px-3.5 text-sm font-bold ${split === k ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>

            {self && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-mist px-4 py-3">
                <input
                  type="checkbox"
                  checked={includeMe}
                  onChange={(e) => setIncludeMe(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
                />
                <span className="text-sm">
                  <span className="font-bold">Include myself in the payment</span>
                  <span className="block text-muted">Your share counts toward the total, split the same way, and is marked settled.</span>
                </span>
              </label>
            )}

            {people.length > 0 ? (
              <ul className="mt-4 flex flex-col">
                {people.map((m, i) => {
                  const isMe = m.user_id === me;
                  return (
                    <PersonRow
                      key={m.user_id}
                      person={m}
                      label={isMe ? "You" : personName(m)}
                      note={isMe ? "Included with the checkbox above" : undefined}
                      amount={amounts[i]}
                      split={split}
                      customText={split === "percent" ? (percents[m.user_id] ?? "") : (custom[m.user_id] ?? "")}
                      onCustom={(v) =>
                        split === "percent" ? setPercents((c) => ({ ...c, [m.user_id]: v })) : setCustom((c) => ({ ...c, [m.user_id]: v }))
                      }
                      onRemove={isMe ? undefined : () => setPicked((p) => ({ ...p, [m.user_id]: false }))}
                    />
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 rounded-2xl bg-mist p-4 text-center text-sm text-muted">No one added yet.</p>
            )}

            <AddPeople
              // Everyone else in the group who isn't in the split yet (you're included with the checkbox).
              choices={others.filter((m) => !picked[m.user_id])}
              me={me}
              onAdd={(m) => setPicked((p) => ({ ...p, [m.user_id]: true }))}
              onSelectAll={() => setPicked(Object.fromEntries(others.map((m) => [m.user_id, true])))}
              allAdded={others.every((m) => picked[m.user_id])}
              hasOthers={others.length > 0}
            />

            {people.length > 0 && (total !== null || split === "percent") && (
              <p
                className={`mt-3 text-sm font-semibold ${
                  (split === "amount" && !totalAuto && left !== 0) || (split === "percent" && bpSum !== 10000) ? "text-honey" : "text-muted"
                }`}
              >
                {split === "equal"
                  ? `${dollars(total ?? 0)} split between ${people.length} ${people.length === 1 ? "person" : "people"}.`
                  : split === "percent"
                    ? bpSum === 10000
                      ? `Adds up to 100%${total ? ` of ${dollars(total)}` : ""}.`
                      : bpSum < 10000
                        ? `${percentText(10000 - bpSum)}% left to assign.`
                        : `${percentText(bpSum - 10000)}% over 100%.`
                    : totalAuto
                      ? `The total adds up to ${dollars(typedSum)}.`
                      : left === 0
                        ? `Adds up to ${dollars(total ?? 0)}.`
                        : left > 0
                          ? `${dollars(left)} left to assign.`
                          : `${dollars(-left)} over the total.`}
              </p>
            )}
            <ErrorLine text={show("people") ?? show("split")} />
          </section>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {error && (
            <p role="alert" className="mr-auto text-sm font-semibold text-warn">
              {error}
            </p>
          )}
          <Link href={back} className="flex h-12 items-center rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy || scan?.status === "scanning"}
            aria-busy={busy}
            className="flex h-12 items-center gap-2 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            {busy && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
            {busy ? "Sending…" : "Send Request"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Pieces ---------- */

const choiceClass = "flex h-12 items-center gap-2.5 rounded-xl border border-line bg-white px-4 font-bold text-ink hover:bg-tint";

const inputClass = (bad: boolean) =>
  `h-12 w-full rounded-xl border bg-white px-3.5 text-base outline-none placeholder:text-muted focus-within:ring-3 ${
    bad ? "border-warn focus-within:ring-warn/15" : "border-line focus-within:border-brand focus-within:ring-brand/15"
  }`;

function Field({
  label,
  required,
  hint,
  counter,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  counter?: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-5 flex flex-col gap-1.5">
      <span className="flex justify-between text-sm font-bold">
        <span>
          {label} {required && <span className="text-warn">*</span>}
          {hint && <span className="font-medium text-muted"> · {hint}</span>}
        </span>
        {counter && <span className="font-medium text-muted">{counter}</span>}
      </span>
      {children}
      <ErrorLine text={error} />
    </label>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <span className="mt-1 block text-sm font-semibold text-warn">{text}</span> : null;
}

function PersonRow({
  person,
  label,
  note,
  amount,
  split,
  customText,
  onCustom,
  onRemove,
}: {
  person: Member;
  label: string;
  note?: string;
  amount: number;
  split: Split;
  customText: string;
  onCustom: (v: string) => void;
  /** Leave out to hide the remove button (your own row is controlled by the checkbox). */
  onRemove?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-[#EEF1EA] py-2.5 last:border-b-0">
      <Avatar src={person.avatar_url} name={personName(person)} seed={person.user_id} size={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-bold">{label}</span>
        <span className="truncate text-[13px] text-muted">{note ?? `@${person.username}`}</span>
      </span>
      {split === "equal" ? (
        <span className="shrink-0 font-bold">{dollars(amount)}</span>
      ) : split === "percent" ? (
        <span className="flex shrink-0 items-center gap-2.5">
          <span className="text-sm text-muted">{dollars(amount)}</span>
          <span className="flex h-11 w-24 items-center rounded-xl border border-line bg-white px-3 focus-within:border-brand">
            <input
              inputMode="decimal"
              value={customText}
              onChange={(e) => onCustom(e.target.value)}
              placeholder="0"
              aria-label={`Percent for ${label}`}
              className="min-w-0 flex-1 bg-transparent text-right outline-none"
            />
            <span className="pl-1 text-muted">%</span>
          </span>
        </span>
      ) : (
        <span className="flex h-11 w-28 shrink-0 items-center rounded-xl border border-line bg-white px-3 focus-within:border-brand">
          <span className="text-muted">$</span>
          <input
            inputMode="decimal"
            value={customText}
            onChange={(e) => onCustom(e.target.value)}
            placeholder="0.00"
            aria-label={`Amount for ${label}`}
            className="min-w-0 flex-1 bg-transparent pl-1 text-right outline-none"
          />
        </span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from the split`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      ) : (
        <span className="w-10 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}

/** Add People: the group's member list is always shown, each person with an Add button,
 *  plus Select All. People already in the split drop off the list. */
function AddPeople({
  choices,
  me,
  onAdd,
  onSelectAll,
  allAdded,
  hasOthers,
}: {
  choices: Member[];
  me: string;
  onAdd: (m: Member) => void;
  onSelectAll: () => void;
  allAdded: boolean;
  hasOthers: boolean;
}) {
  if (!hasOthers) return <p className="mt-3 text-sm text-muted">Invite people to the group first.</p>;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="text-sm font-bold">Add people</p>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={allAdded}
          className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-bold text-ink hover:bg-tint disabled:opacity-50"
        >
          Select All
        </button>
      </div>
      {choices.length ? (
        <ul className="max-h-72 overflow-y-auto">
          {choices.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-mist">
              <Avatar src={m.avatar_url} name={personName(m)} seed={m.user_id} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold">{m.user_id === me ? "You" : personName(m)}</span>
                <span className="truncate text-xs text-muted">@{m.username}</span>
              </span>
              <button
                type="button"
                onClick={() => onAdd(m)}
                aria-label={`Add ${personName(m)}`}
                className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-brand px-3 text-sm font-bold text-white hover:bg-brand-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2 py-3 text-sm text-muted">Everyone in the group has been added.</p>
      )}
    </div>
  );
}

/** The AI's digital receipt, as editable fields so the requester can correct anything. */
function DigitalReceiptEditor({
  receipt,
  onChange,
  onUseTotal,
  total,
}: {
  receipt: DigitalReceipt;
  onChange: (change: Partial<DigitalReceipt>) => void;
  onUseTotal: (cents: number) => void;
  total: number | null;
}) {
  const money = (cents: number | null) => (cents === null ? "" : centsText(cents));
  const setMoney = (key: "subtotal_cents" | "tax_cents" | "tip_cents" | "total_cents", text: string) =>
    onChange({ [key]: text.trim() === "" ? null : parseCents(text) });

  if (!receipt.is_receipt || !receipt.readable) {
    return (
      <div role="alert" className="rounded-2xl bg-butter p-4 text-sm">
        <p className="font-bold text-honey">{receipt.is_receipt ? "That receipt is hard to read" : "That doesn't look like a receipt"}</p>
        <p className="mt-1 text-ink">{receipt.problem ?? "Try a clearer photo, or fill in the total yourself."}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-mist p-4">
      <p className="text-[11px] font-bold tracking-[0.14em] text-[#3E4A43] uppercase">Digital receipt · check and correct</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MiniField label="Vendor" value={receipt.vendor ?? ""} onChange={(v) => onChange({ vendor: v || null })} />
        <MiniField label="Date" type="date" value={receipt.date ?? ""} onChange={(v) => onChange({ date: v || null })} />
      </div>

      {receipt.items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {receipt.items.map((item, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                value={item.name}
                aria-label={`Item ${i + 1}`}
                onChange={(e) => onChange({ items: receipt.items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 text-sm outline-none focus:border-brand"
              />
              <input
                inputMode="decimal"
                defaultValue={centsText(item.amount_cents)}
                aria-label={`Amount for item ${i + 1}`}
                onBlur={(e) => {
                  const cents = parseCents(e.target.value);
                  if (cents !== null) onChange({ items: receipt.items.map((x, j) => (j === i ? { ...x, amount_cents: cents } : x)) });
                }}
                className="h-10 w-24 rounded-lg border border-line bg-white px-2.5 text-right text-sm outline-none focus:border-brand"
              />
              <button
                type="button"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => onChange({ items: receipt.items.filter((_, j) => j !== i) })}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniField label="Subtotal" money value={money(receipt.subtotal_cents)} onChange={(v) => setMoney("subtotal_cents", v)} />
        <MiniField label="Tax" money value={money(receipt.tax_cents)} onChange={(v) => setMoney("tax_cents", v)} />
        <MiniField label="Tip" money value={money(receipt.tip_cents)} onChange={(v) => setMoney("tip_cents", v)} />
        <MiniField label="Total" money value={money(receipt.total_cents)} onChange={(v) => setMoney("total_cents", v)} />
      </div>

      {receipt.total_cents !== null && receipt.total_cents !== total && (
        <button type="button" onClick={() => onUseTotal(receipt.total_cents!)} className="mt-3 text-sm font-bold text-brand underline">
          Use the receipt total ({dollars(receipt.total_cents)})
        </button>
      )}
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
  type = "text",
  money = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  money?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold text-muted">{label}</span>
      {money ? (
        // Money fields save when you leave the box, so typing "12." isn't cut short.
        <input
          key={value}
          inputMode="decimal"
          defaultValue={value}
          onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
          className="h-10 rounded-lg border border-line bg-white px-2.5 text-sm outline-none focus:border-brand"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 rounded-lg border border-line bg-white px-2.5 text-sm outline-none focus:border-brand"
        />
      )}
    </label>
  );
}
