"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoltIcon, CheckIcon, ChevronLeftIcon, FileIcon, PaperclipIcon, PenIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { PdfView } from "../../../group/[chatId]/documents/[requestId]/files/[fileId]/FileViewer";
import { DOC_FILE_MAX, docMimeType, storageName } from "../../../group/documents";
import { uploadFile } from "../../../group/messages";
import { titleOf, type Conversation } from "../../../group/types";
import { buildFormPdf, emptyForm, fileNameFor, formProgress, saveDraft, type FormData, type FormField } from "../../drafting";
import SendPanel from "../../SendPanel";

// Fill Out a Form. 1. Upload the empty form (and optionally say which chat it's for).
// 2. AI turns it into simple questions and pre-fills what it knows; each pre-filled answer
// says where it came from, and everything can be changed. 3. Finish: CommonTab makes the filled
// PDF (the original with its fields filled when it has fillable fields, otherwise a clean new
// PDF). 4. Download it, send it to a chat, or answer a document request with it.

type State = { status: "loading" } | { status: "error" } | { status: "ready" };

export default function FormDraft() {
  const { draftId } = useParams<{ draftId: string }>();
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [data, setData] = useState<FormData>(emptyForm);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "failed" | null>(null);
  const [preview, setPreview] = useState<{ url: string; bytes: Uint8Array } | null>(null);
  const [tried, setTried] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [draft, convos] = await Promise.all([
        supabase.from("drafts").select("kind, title, status, source_path, source_name, data").eq("id", draftId).maybeSingle(),
        supabase.rpc("my_conversations"),
      ]);
      if (!live) return;
      if (draft.error) return setState({ status: "error" });
      setChats((convos.data ?? []) as Conversation[]);
      if (draft.data && draft.data.kind === "form") {
        setData({ ...emptyForm(), ...(draft.data.data as Partial<FormData>), title: draft.data.title });
        setSourcePath(draft.data.source_path);
        setSourceName(draft.data.source_name);
      }
      loaded.current = true;
      setState({ status: "ready" });
    })();
    return () => {
      live = false;
    };
  }, [supabase, draftId]);

  // Save as you go (a moment after each change).
  const save = useCallback(
    async (next: FormData, extra?: { filePath?: string; fileName?: string; status?: "draft" | "done" }) => {
      setSaved("saving");
      const ok = await saveDraft(supabase, {
        id: draftId,
        kind: "form",
        title: next.title || sourceName || "Untitled form",
        data: next,
        status: extra?.status ?? (next.stage === "done" ? "done" : "draft"),
        filePath: extra?.filePath,
        fileName: extra?.fileName,
      });
      setSaved(ok ? "saved" : "failed");
      return ok;
    },
    [supabase, draftId, sourceName],
  );
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = (change: Partial<FormData>) => {
    setData((d) => {
      const next = { ...d, ...change };
      clearTimeout(pending.current);
      pending.current = setTimeout(() => save(next), 800);
      return next;
    });
  };

  /* ---------- 1. Upload and read the form ---------- */

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    const type = docMimeType(file);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!type || !(["pdf", "docx"].includes(ext ?? "") || type.startsWith("image/"))) {
      return setProblem("Upload the form as a PDF, a Word file (.docx) or a photo.");
    }
    if (file.size > DOC_FILE_MAX) return setProblem("That file is too big (15 MB max).");
    setBusy("Uploading the form…");
    try {
      const path = `${me}/${draftId}/${storageName(0, file.name)}`;
      await uploadFile(supabase, "drafts", path, file, type, "15 MB", () => {}).promise;
      setSourcePath(path);
      setSourceName(file.name);
      const next = { ...data, title: data.title || file.name.replace(/\.[^.]+$/, "") };
      if (!(await save(next, { filePath: path, fileName: file.name }))) throw new Error("Couldn't save the draft. Try again.");
      setData(next);
      await read(next);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't upload the form. Try again.");
    }
    setBusy(null);
  }

  async function read(current: FormData) {
    setBusy("CommonTab AI is reading the form…");
    setProblem(null);
    const res = await fetch("/api/ai/form", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_id: draftId, conversation_id: current.conversation_id }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as Partial<FormData> & { error?: string }) : {};
    setBusy(null);
    if (!res?.ok || !body.fields) {
      setProblem(body.error ?? "Couldn't read the form right now. Try again.");
      return;
    }
    const next: FormData = {
      ...current,
      stage: "fill",
      title: body.title || current.title,
      instructions: body.instructions ?? null,
      fields: body.fields,
      answers: body.answers ?? {},
      sources: body.sources ?? {},
      file_kind: body.file_kind ?? null,
      fillable: Boolean(body.fillable),
    };
    setData(next);
    save(next);
  }

  /* ---------- 3. Finish ---------- */

  async function finish() {
    setTried(true);
    const { missing } = formProgress(data);
    if (missing.length) {
      setProblem(`Answer the required ${missing.length === 1 ? "question" : "questions"} first: ${missing.map((m) => m.label).slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
      return;
    }
    setBusy("Making the filled form…");
    setProblem(null);
    try {
      let original: ArrayBuffer | null = null;
      if (data.fillable && sourcePath) {
        const { data: blob } = await supabase.storage.from("drafts").download(sourcePath);
        original = blob ? await blob.arrayBuffer() : null;
      }
      const bytes = await buildFormPdf(data, original);
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), bytes });
      if (data.remember) {
        await supabase.rpc("remember_form_answers", {
          items: data.fields
            .filter((f) => f.type !== "signature" && data.answers[f.id]?.trim())
            .map((f) => ({ key: f.key, label: f.label, value: data.answers[f.id] })),
        });
      }
      const next = { ...data, stage: "done" as const };
      setData(next);
      save(next, { status: "done" });
    } catch (e) {
      console.error(e);
      setProblem("Couldn't make the filled form. Try again.");
    }
    setBusy(null);
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">Couldn&apos;t open this draft</p>
        <p className="mt-1.5 text-sm text-muted">Check your connection and try again.</p>
        <Link href="/documents" className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
          Back to Document Drafting
        </Link>
      </div>
    );
  }

  const progress = formProgress(data);
  const prefilled = Object.keys(data.sources).filter((id) => data.answers[id]).length;
  const sections = data.fields.reduce<{ name: string | null; fields: FormField[] }[]>((list, f) => {
    const last = list[list.length - 1];
    if (last && last.name === f.section) last.fields.push(f);
    else list.push({ name: f.section, fields: [f] });
    return list;
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/documents" className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
          <ChevronLeftIcon className="h-4 w-4" />
          Document Drafting
        </Link>
        <span role="status" className="text-[13px] text-muted">
          {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "failed" ? "Couldn't save. Keep this page open." : ""}
        </span>
      </div>

      {/* Header */}
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <div className="flex items-start gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
            <FileIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Fill Out a Form</p>
            {data.stage === "upload" ? (
              <h2 className="text-[26px] font-extrabold tracking-tight">Upload the empty form</h2>
            ) : (
              <input
                value={data.title}
                onChange={(e) => update({ title: e.target.value.slice(0, 120) })}
                aria-label="Form title"
                className="w-full rounded-lg bg-transparent text-[26px] font-extrabold tracking-tight outline-none focus:bg-mist"
              />
            )}
            {sourceName && <p className="truncate text-sm text-muted">From {sourceName}</p>}
          </div>
        </div>
        {data.instructions && data.stage !== "upload" && <p className="mt-3 rounded-2xl bg-mist px-4 py-3 text-sm whitespace-pre-wrap text-ink">{data.instructions}</p>}
      </section>

      {busy && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-tint px-4 py-3 text-sm font-bold text-brand">
          <BoltIcon className="h-4 w-4" />
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-2xl bg-butter px-4 py-3 text-sm font-semibold text-honey">
          {problem}
        </p>
      )}

      {/* 1. Upload */}
      {data.stage === "upload" && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-bold">
              Which chat is it for? <span className="font-medium text-muted">· Optional, helps fill in group and trip details</span>
            </span>
            <select
              value={data.conversation_id ?? ""}
              onChange={(e) => setData((d) => ({ ...d, conversation_id: e.target.value || null }))}
              className="h-12 rounded-xl border border-line bg-white px-3 text-base"
            >
              <option value="">No chat</option>
              {chats.map((c) => (
                <option key={c.id} value={c.id}>
                  {titleOf(c, me)}
                  {c.kind === "dm" ? " (direct message)" : ""}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {sourcePath ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-mist p-4">
              <p className="min-w-0 flex-1 truncate text-sm font-bold">{sourceName}</p>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => read(data)}
                className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                Read the Form
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => fileInput.current?.click()}
              className="mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand/40 bg-tint px-4 py-8 text-brand hover:border-brand disabled:opacity-60"
            >
              <PaperclipIcon className="h-6 w-6" />
              <span className="font-bold">Upload the Empty Form</span>
              <span className="text-[13px] text-muted">PDF, Word (.docx) or a photo, up to 15 MB</span>
            </button>
          )}
          <p className="mt-3 text-[13px] text-muted">
            CommonTab AI reads the form and fills in what it already knows: your profile, answers you chose to remember, and the chat it&apos;s for. You check
            and change anything before it goes anywhere.
          </p>
        </section>
      )}

      {/* 2. Fill in */}
      {data.stage === "fill" && (
        <>
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold">
                {progress.answered} of {progress.total} answered
              </p>
              {prefilled > 0 && (
                <p className="flex items-center gap-1.5 text-[13px] text-brand">
                  <BoltIcon className="h-3.5 w-3.5" />
                  AI filled in {prefilled} for you. Check them.
                </p>
              )}
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={progress.answered} aria-valuemin={0} aria-valuemax={progress.total}>
              <div className="h-full rounded-full bg-leaf" style={{ width: `${progress.total ? (progress.answered / progress.total) * 100 : 0}%` }} />
            </div>
          </section>

          {sections.map((s, i) => (
            <section key={`${s.name}-${i}`} className="rounded-3xl border border-line bg-white p-6 sm:p-7">
              {s.name && <h3 className="mb-1 text-lg font-extrabold">{s.name}</h3>}
              <div className="flex flex-col">
                {s.fields.map((f) => (
                  <FieldInput
                    key={f.id}
                    field={f}
                    value={data.answers[f.id] ?? ""}
                    source={data.sources[f.id] ?? null}
                    missing={tried && f.required && !formProgress({ ...data, fields: [f] }).answered}
                    onChange={(v) => {
                      const sources = { ...data.sources };
                      delete sources[f.id]; // your own answer now
                      update({ answers: { ...data.answers, [f.id]: v }, sources });
                    }}
                  />
                ))}
              </div>
            </section>
          ))}

          <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-white p-6 sm:p-7">
            <label className="flex min-h-11 flex-1 items-center gap-2.5 text-sm">
              <input type="checkbox" checked={data.remember} onChange={(e) => update({ remember: e.target.checked })} className="h-5 w-5 accent-[#2E6A45]" />
              Remember my answers to fill in my next forms (only you can see them)
            </label>
            <button type="button" disabled={Boolean(busy)} onClick={finish} className="h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              Finish Form
            </button>
          </section>
        </>
      )}

      {/* 3. Done: preview and send */}
      {data.stage === "done" && (
        <>
          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex flex-1 items-center gap-2 font-extrabold text-brand">
                <CheckIcon className="h-5 w-5" />
                Your filled-out form is ready
              </p>
              <button
                type="button"
                onClick={() => update({ stage: "fill" })}
                className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
              >
                <PenIcon className="h-4 w-4" />
                Edit Answers
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">
              {data.fillable ? "Your answers were filled into the original form." : "CommonTab made a clean PDF of the form with your answers."} Check it before you send it.
            </p>
            <div className="mt-3">
              {preview ? (
                <PdfView url={preview.url} />
              ) : (
                <button type="button" onClick={finish} className="h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
                  Show the Filled Form
                </button>
              )}
            </div>
          </section>
          <SendPanel
            title={data.title || "the form"}
            defaultChatId={data.conversation_id}
            formats={[{ id: "pdf", label: "PDF" }]}
            makeFile={async () => {
              let bytes = preview?.bytes;
              if (!bytes) {
                let original: ArrayBuffer | null = null;
                if (data.fillable && sourcePath) {
                  const { data: blob } = await supabase.storage.from("drafts").download(sourcePath);
                  original = blob ? await blob.arrayBuffer() : null;
                }
                bytes = await buildFormPdf(data, original);
              }
              return new File([bytes as BlobPart], fileNameFor(`${data.title} (filled)`, "pdf"), { type: "application/pdf" });
            }}
            onSent={() => save(data, { status: "done" })}
          />
        </>
      )}
    </div>
  );
}

/* ---------- One question ---------- */

const inputClass = (bad: boolean) =>
  `h-12 w-full rounded-xl border bg-white px-3.5 text-base outline-none placeholder:text-muted focus:ring-3 ${
    bad ? "border-warn focus:ring-warn/15" : "border-line focus:border-brand focus:ring-brand/15"
  }`;

function FieldInput({
  field,
  value,
  source,
  missing,
  onChange,
}: {
  field: FormField;
  value: string;
  source: string | null;
  missing: boolean;
  onChange: (v: string) => void;
}) {
  const label = (
    <span className="text-sm font-bold">
      {field.label} {field.required && <span className="text-warn">*</span>}
    </span>
  );
  const extra = (
    <>
      {field.help && <span className="text-[13px] text-muted">{field.help}</span>}
      {source && value && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-tint px-2.5 py-0.5 text-[12px] font-bold text-brand">
          <BoltIcon className="h-3 w-3" />
          Filled in from {source}
        </span>
      )}
      {missing && <span className="text-sm font-semibold text-warn">This one is required.</span>}
    </>
  );

  if (field.type === "checkbox") {
    return (
      <div className="flex flex-col gap-1 border-b border-[#EEF1EA] py-3 last:border-b-0">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} className="h-5 w-5 shrink-0 accent-[#2E6A45]" />
          {label}
        </label>
        {extra}
      </div>
    );
  }
  if (field.type === "choice" && field.options?.length) {
    return (
      <fieldset className="flex flex-col gap-1.5 border-b border-[#EEF1EA] py-3 last:border-b-0">
        <legend className="mb-1.5">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {field.options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={value === o}
              onClick={() => onChange(value === o ? "" : o)}
              className={`min-h-11 rounded-full border px-4 text-sm font-bold ${value === o ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-tint"}`}
            >
              {o}
            </button>
          ))}
        </div>
        {extra}
      </fieldset>
    );
  }
  if (field.type === "signature") {
    return (
      <div className="flex flex-col gap-1.5 border-b border-[#EEF1EA] py-3 last:border-b-0">
        {label}
        <SignatureInput value={value} onChange={onChange} />
        {extra}
      </div>
    );
  }
  return (
    <label className="flex flex-col gap-1.5 border-b border-[#EEF1EA] py-3 last:border-b-0">
      {label}
      {field.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 2000))}
          rows={3}
          className={`w-full rounded-xl border bg-white px-3.5 py-3 text-base outline-none focus:ring-3 ${missing ? "border-warn" : "border-line focus:border-brand focus:ring-brand/15"}`}
        />
      ) : (
        <input
          type={field.type === "date" ? "date" : field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 500))}
          className={inputClass(missing)}
        />
      )}
      {extra}
    </label>
  );
}

/** A signature: type your name, or draw it with a finger or mouse. */
function SignatureInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"typed" | "drawn">(value.startsWith("drawn:") ? "drawn" : "typed");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width, y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height };
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2" role="radiogroup" aria-label="How to sign">
        {(["typed", "drawn"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => {
              setMode(m);
              onChange("");
            }}
            className={`h-10 rounded-full border px-4 text-sm font-bold ${mode === m ? "border-brand bg-tint text-brand" : "border-line bg-white text-ink"}`}
          >
            {m === "typed" ? "Type It" : "Draw It"}
          </button>
        ))}
      </div>
      {mode === "typed" ? (
        <input
          value={value.startsWith("typed:") ? value.slice(6) : ""}
          onChange={(e) => onChange(e.target.value ? `typed:${e.target.value.slice(0, 80)}` : "")}
          placeholder="Type your full name to sign"
          aria-label="Type your name to sign"
          className="h-14 w-full rounded-xl border border-line bg-white px-3.5 font-serif text-xl italic outline-none focus:border-brand"
        />
      ) : (
        <div className="flex flex-col gap-2">
          <canvas
            ref={canvas}
            width={600}
            height={180}
            aria-label="Draw your signature"
            className="h-[120px] w-full touch-none rounded-xl border border-line bg-white"
            onPointerDown={(e) => {
              const ctx = e.currentTarget.getContext("2d");
              if (!ctx) return;
              drawing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              ctx.lineWidth = 4;
              ctx.lineCap = "round";
              ctx.strokeStyle = "#17221B";
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = e.currentTarget.getContext("2d");
              const p = point(e);
              ctx?.lineTo(p.x, p.y);
              ctx?.stroke();
              drew.current = true;
            }}
            onPointerUp={(e) => {
              drawing.current = false;
              if (drew.current) onChange(`drawn:${e.currentTarget.toDataURL("image/png")}`);
            }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                const c = canvas.current;
                c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
                drew.current = false;
                onChange("");
              }}
              className="h-10 rounded-lg border border-line bg-white px-3.5 text-sm font-bold"
            >
              Clear
            </button>
            {value.startsWith("drawn:") && <span className="text-[13px] text-brand">Signed</span>}
          </div>
        </div>
      )}
    </div>
  );
}
