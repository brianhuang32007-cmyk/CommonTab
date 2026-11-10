"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BoltIcon, CloseIcon, FileIcon, ReceiptIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { stamp } from "../group/requests";
import { formHref, sheetHref, type DraftRow } from "./drafting";

// Document Drafting: two AI tools, and the drafts you've started.
//   • Fill Out a Form: upload an empty form; AI turns it into simple questions, fills in what it
//     knows, and gives you the finished form to send to a chat or a document request.
//   • Build a Spreadsheet: pick chats and say what you need; AI plans it, plain code does the math.

export default function DraftingHome() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [remembered, setRemembered] = useState<number | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const load = useCallback(async () => {
    const [list, memory] = await Promise.all([
      supabase.from("drafts").select("id, kind, title, status, source_name, updated_at").order("updated_at", { ascending: false }).limit(100),
      supabase.from("form_memory").select("field_key", { count: "exact", head: true }),
    ]);
    if (list.error) setFailed(true);
    else {
      setFailed(false);
      setDrafts((list.data ?? []) as DraftRow[]);
    }
    if (!memory.error) setRemembered(memory.count ?? 0);
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const start = (kind: "form" | "sheet") => {
    const id = crypto.randomUUID();
    router.push(kind === "form" ? formHref(id) : sheetHref(id));
  };

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 pb-10">
      <div className="grid gap-4 md:grid-cols-2">
        <Tool
          icon={<FileIcon className="h-6 w-6" />}
          title="Fill Out a Form"
          text="Upload an empty form (PDF, Word or a photo). AI turns it into simple questions, fills in what it already knows, like your name, birthday or trip dates, and gives you the finished form to send."
          button="Fill Out a Form"
          onClick={() => start("form")}
        />
        <Tool
          icon={<ReceiptIcon className="h-6 w-6" />}
          title="Build a Spreadsheet"
          text="Pick your chats and say what you need, like “a track record of all trip costs”. AI finds the costs in payment requests, receipts and messages, and CommonTab adds everything up."
          button="Build a Spreadsheet"
          onClick={() => start("sheet")}
        />
      </div>

      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <h2 className="text-lg font-extrabold">My drafts</h2>
        <p className="mt-0.5 text-sm text-muted">Forms and spreadsheets save as you go. Only you can see them.</p>
        {failed ? (
          <div role="alert" className="mt-3 flex items-center gap-3 rounded-2xl bg-mist p-4">
            <p className="flex-1 text-sm font-bold">Couldn&apos;t load your drafts</p>
            <button type="button" onClick={load} className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
              Retry
            </button>
          </div>
        ) : drafts === null ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Loading…
          </p>
        ) : drafts.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-mist px-4 py-6 text-center text-sm text-muted">Nothing yet. Start a form or a spreadsheet above.</p>
        ) : (
          <ul className="mt-3 flex flex-col">
            {drafts.map((d) => (
              <DraftItem key={d.id} draft={d} onDeleted={() => setDrafts((list) => (list ?? []).filter((x) => x.id !== d.id))} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-white p-6 sm:p-7">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold">Remembered answers</h2>
          <p className="mt-0.5 text-sm text-muted">
            {remembered === null
              ? "Answers you choose to remember are used to fill in your next forms. Only you can see them."
              : remembered === 0
                ? "No remembered answers yet. When you finish a form, you can choose to remember your answers for next time."
                : `${remembered} ${remembered === 1 ? "answer is" : "answers are"} remembered to fill in your next forms. Only you can see them.`}
          </p>
        </div>
        {Boolean(remembered) && (
          <button
            type="button"
            disabled={forgetting}
            onClick={async () => {
              setForgetting(true);
              const { error } = await supabase.rpc("forget_form_answers");
              setForgetting(false);
              if (!error) setRemembered(0);
            }}
            className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-60"
          >
            {forgetting ? "Forgetting…" : "Forget All"}
          </button>
        )}
      </section>
    </div>
  );
}

function Tool({ icon, title, text, button, onClick }: { icon: React.ReactNode; title: string; text: string; button: string; onClick: () => void }) {
  return (
    <section className="flex flex-col rounded-3xl border border-line bg-white p-6 sm:p-7">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tint text-brand">{icon}</span>
      <h2 className="mt-3 text-xl font-extrabold">{title}</h2>
      <p className="mt-1 flex-1 text-sm text-muted">{text}</p>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <BoltIcon className="h-3.5 w-3.5 text-brand" />
        CommonTab AI drafts; you check it and decide where it goes.
      </p>
      <button type="button" onClick={onClick} className="mt-4 h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover">
        {button}
      </button>
    </section>
  );
}

function DraftItem({ draft, onDeleted }: { draft: DraftRow; onDeleted: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { id: me } = useProfile();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const href = draft.kind === "form" ? formHref(draft.id) : sheetHref(draft.id);
  return (
    <li className="border-b border-[#EEF1EA] py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 hover:bg-mist">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
            {draft.kind === "form" ? <FileIcon className="h-5 w-5" /> : <ReceiptIcon className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{draft.title}</span>
            <span className="block text-[13px] text-muted">
              {draft.kind === "form" ? "Form" : "Spreadsheet"} · Edited {stamp(draft.updated_at)}
            </span>
          </span>
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${draft.status === "done" ? "bg-brand text-white" : "bg-butter-strong text-[#5C4A0B]"}`}
          >
            {draft.status === "done" ? "Done" : "Draft"}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={`Delete ${draft.title}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-mist hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Delete this draft?" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-butter p-3">
          <p className="flex-1 text-sm font-bold text-honey">Delete this draft? This can&apos;t be undone.</p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              // The uploaded form goes too (best effort).
              const folder = `${me}/${draft.id}`;
              const { data: files } = await supabase.storage.from("drafts").list(folder);
              const { error } = await supabase.rpc("delete_draft", { draft_id: draft.id });
              if (!error && files?.length) await supabase.storage.from("drafts").remove(files.map((f) => `${folder}/${f.name}`));
              setBusy(false);
              if (!error) onDeleted();
            }}
            className="h-10 rounded-lg bg-ink px-3.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
          >
            {busy ? "Deleting…" : "Yes, Delete"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="h-10 rounded-lg border border-line bg-white px-3.5 text-sm font-bold">
            Keep It
          </button>
        </div>
      )}
    </li>
  );
}
