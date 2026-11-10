"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { ChevronLeftIcon, CloseIcon, FileIcon, PlusIcon } from "@/components/app/icons";
import { createClient } from "@/lib/supabase/client";
import { DOC_TYPES, type DocType } from "../../../documents";
import { todayIso } from "../../../requests";
import { otherMember, personName, type Conversation, type Member } from "../../../types";

// Request Document: anyone in a group or DM asks one or more people for a document. Title,
// type, instructions, an optional due date, and who gets it. Sending saves the request and
// posts its card in the chat (the database checks everything again).

const TITLE_MAX = 80;
const OTHER_MAX = 40;
const INSTRUCTIONS_MAX = 500;

export default function DocumentForm({ chat, me, chatTitle }: { chat: Conversation; me: string; chatTitle: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const back = `/group?chat=${chat.id}`;
  // Made once per form, so a retry can't create a second request.
  const [requestId] = useState(() => crypto.randomUUID());
  const isDm = chat.kind === "dm";
  const other = isDm ? otherMember(chat, me) : undefined;

  const others = useMemo(
    () => chat.members.filter((m) => m.user_id !== me).sort((a, b) => personName(a).localeCompare(personName(b))),
    [chat.members, me],
  );

  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocType | null>(null);
  const [typeOther, setTypeOther] = useState("");
  const [instructions, setInstructions] = useState("");
  const [due, setDue] = useState("");
  // In a DM, the other person is the one asked. In a group, the requester picks.
  const [picked, setPicked] = useState<string[]>(() => (other ? [other.user_id] : []));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = others.filter((m) => picked.includes(m.user_id));
  const choices = others.filter((m) => !picked.includes(m.user_id));

  const problems = {
    title: !title.trim() ? "Add a title." : null,
    type: !type ? "Pick a document type." : type === "other" && !typeOther.trim() ? "Name the document type." : null,
    due: due && due < todayIso() ? "The due date can't be in the past." : null,
    people: !picked.length ? (isDm ? "This person has left the chat." : "Add at least one person to send it.") : null,
  };
  const firstProblem = Object.values(problems).find(Boolean) ?? null;
  const show = (key: keyof typeof problems) => (tried ? problems[key] : null);

  async function send() {
    setTried(true);
    if (busy || firstProblem) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await supabase.rpc("create_document_request", {
      req_id: requestId,
      target: chat.id,
      request_title: title.trim(),
      type_key: type,
      type_other: type === "other" ? typeOther.trim() : null,
      request_instructions: instructions.trim() || null,
      due: due || null,
      recipient_ids: picked,
    });
    if (saveError) {
      // Everything entered stays, so you can try again.
      setError(saveError.message || "Couldn't send the request. Check your connection and try again.");
      setBusy(false);
      return;
    }
    router.push(back);
  }

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
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex items-center gap-3.5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
                <FileIcon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[26px] font-extrabold tracking-tight">Request Document</h2>
                <p className="truncate text-sm text-muted">In {chatTitle}</p>
              </div>
            </div>

            <Field label="Title" required error={show("title")} counter={`${title.length}/${TITLE_MAX}`}>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                placeholder="e.g. Fall spending records"
                className={inputClass(Boolean(show("title")))}
              />
            </Field>

            <fieldset className="mt-5">
              <legend className="text-sm font-bold">
                Document type <span className="text-warn">*</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {DOC_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={type === t.id}
                    onClick={() => setType(t.id)}
                    className={`h-11 rounded-full border px-4 text-sm font-bold ${
                      type === t.id ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-tint"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {type === "other" && (
                <input
                  value={typeOther}
                  onChange={(e) => setTypeOther(e.target.value.slice(0, OTHER_MAX))}
                  placeholder="What kind of document? e.g. Budget sheet"
                  aria-label="Document type"
                  className={`mt-2.5 ${inputClass(Boolean(show("type")))}`}
                />
              )}
              <ErrorLine text={show("type")} />
            </fieldset>

            <Field label="Instructions" hint="Optional" error={null} counter={`${instructions.length}/${INSTRUCTIONS_MAX}`}>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value.slice(0, INSTRUCTIONS_MAX))}
                rows={3}
                placeholder="e.g. A PDF of everything the club spent this semester, with dates and totals."
                className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none placeholder:text-muted focus:border-brand focus:ring-3 focus:ring-brand/15"
              />
            </Field>

            <Field label="Due date" hint="Optional" error={show("due")}>
              <input
                type="date"
                min={todayIso()}
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={`sm:max-w-[260px] ${inputClass(Boolean(show("due")))}`}
              />
            </Field>
          </section>

          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="text-lg font-extrabold">Who sends it</h3>
            <p className="mt-0.5 text-sm text-muted">
              {isDm
                ? "In a direct message, the other person is asked."
                : "Pick one or more people. Each person uploads their own copy. Only you and they can open what they send."}
            </p>

            {chosen.length > 0 && (
              <ul className="mt-3" aria-label="People asked">
                {chosen.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 border-b border-[#EEF1EA] py-2.5 last:border-b-0">
                    <Avatar src={m.avatar_url} name={personName(m)} seed={m.user_id} size={36} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-bold">{personName(m)}</span>
                      <span className="truncate text-[13px] text-muted">@{m.username}</span>
                    </span>
                    {!isDm && (
                      <button
                        type="button"
                        onClick={() => setPicked((p) => p.filter((id) => id !== m.user_id))}
                        aria-label={`Remove ${personName(m)}`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist hover:text-ink"
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {!isDm && (
              <AddPeople
                choices={choices}
                hasOthers={others.length > 0}
                onAdd={(m) => setPicked((p) => [...p, m.user_id])}
                onSelectAll={() => setPicked(others.map((m) => m.user_id))}
              />
            )}
            <ErrorLine text={show("people")} />
          </section>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-2xl bg-butter px-4 py-3 text-sm font-semibold text-honey">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {tried && firstProblem && <p className="mr-auto text-sm font-semibold text-warn">{firstProblem}</p>}
          <Link href={back} className="flex h-12 items-center rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist">
            Cancel
          </Link>
          <button
            type="submit"
            disabled={busy}
            className="h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send Request"}
          </button>
        </div>
      </form>
    </div>
  );
}

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

/** The group's members, each with an Add button, plus Select All (as on Request Payment). */
function AddPeople({
  choices,
  hasOthers,
  onAdd,
  onSelectAll,
}: {
  choices: Member[];
  hasOthers: boolean;
  onAdd: (m: Member) => void;
  onSelectAll: () => void;
}) {
  if (!hasOthers) return <p className="mt-3 text-sm text-muted">Invite people to the group first.</p>;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="text-sm font-bold">Add people</p>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={!choices.length}
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
                <span className="truncate text-sm font-bold">{personName(m)}</span>
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
