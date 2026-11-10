"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { BoltIcon, CameraIcon, CheckIcon, CloseIcon, FileIcon, PaperclipIcon, UploadIcon } from "@/components/app/icons";
import { createClient } from "@/lib/supabase/client";
import {
  DOC_ACCEPT,
  DOC_FILE_MAX,
  DOC_FILES_MAX,
  docMimeType,
  fileHref,
  fileKindLabel,
  NOTE_MAX,
  REASON_MAX,
  storageName,
  type AiCheckResult,
  type DocStatus,
  type DocumentDetails,
  type DocUpload,
} from "../../../documents";
import { fileSize, uploadFile } from "../../../messages";
import { stamp } from "../../../requests";

// The interactive parts of a document request's page: uploading (with AI Verify before
// sending), Can't Provide, each upload with its files and review buttons, and AI results.

/* ---------- Uploading (the person asked) ---------- */

type Draft = {
  key: string;
  name: string;
  size: number;
  path: string;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
  abort?: () => void;
};

/** Upload Document: pick up to 5 files (15 MB each), add a note, optionally run AI Verify,
 *  then Submit Document. While an upload waits for review it can be replaced. */
export function SenderUpload({ request, me, status, onSent }: { request: DocumentDetails; me: string; status: DocStatus; onSent: () => void }) {
  // Waiting for review or can't provide: the uploader stays closed until asked for.
  const [openPanel, setOpenPanel] = useState(status === "requested" || status === "rejected");
  if (!openPanel) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">
          {status === "submitted"
            ? "Waiting for review. You can still replace what you sent until it's reviewed."
            : "Found it after all? You can still send it."}
        </p>
        <button
          type="button"
          onClick={() => setOpenPanel(true)}
          className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
        >
          <UploadIcon className="h-4 w-4" />
          {status === "submitted" ? "Replace File" : "Upload Document"}
        </button>
      </div>
    );
  }
  return (
    <Uploader
      request={request}
      me={me}
      replacing={status === "submitted"}
      onCancel={status === "submitted" || status === "cant_provide" ? () => setOpenPanel(false) : undefined}
      onSent={() => {
        setOpenPanel(false);
        onSent();
      }}
    />
  );
}

function Uploader({
  request,
  me,
  replacing,
  onCancel,
  onSent,
}: {
  request: DocumentDetails;
  me: string;
  replacing: boolean;
  onCancel?: () => void;
  onSent: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  // A new id for each upload, so a retry can't send it twice.
  const [uploadId] = useState(() => crypto.randomUUID());
  const [files, setFiles] = useState<Draft[]>([]);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "send" | null>(null);
  // The AI result for this draft (it's saved with the upload and goes with it when sent).
  const [check, setCheck] = useState<{ result: AiCheckResult; status: "verified" | "failed" } | null>(null);
  const counter = useRef(0);
  const attach = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const update = (key: string, change: Partial<Draft>) => setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));

  function add(list: FileList | null) {
    if (!list?.length) return;
    setProblem(null);
    setCheck(null); // the files changed: an earlier AI check no longer applies
    const room = DOC_FILES_MAX - files.length;
    const picked = [...list];
    if (picked.length > room) setProblem(`You can send up to ${DOC_FILES_MAX} files at once.`);
    for (const file of picked.slice(0, Math.max(0, room))) {
      const type = docMimeType(file);
      if (!type) {
        setProblem(`${file.name} isn't a document type CommonTab takes (PDF, photos, Word, Excel, PowerPoint, CSV or text).`);
        continue;
      }
      if (file.size > DOC_FILE_MAX) {
        setProblem(`${file.name} is too big (15 MB max).`);
        continue;
      }
      const key = crypto.randomUUID();
      const path = `${request.id}/${me}/${uploadId}/${storageName(counter.current++, file.name)}`;
      const job = uploadFile(supabase, "request-documents", path, file, type, "15 MB", (p) => update(key, { progress: p }));
      setFiles((l) => [...l, { key, name: file.name, size: file.size, path, status: "uploading", progress: 0, abort: job.abort }]);
      job.promise.then(
        () => update(key, { status: "done", progress: 1 }),
        (e: Error) => update(key, { status: "error", error: e.message }),
      );
    }
  }

  function remove(f: Draft) {
    f.abort?.();
    setFiles((l) => l.filter((x) => x.key !== f.key));
    setCheck(null);
    // Best effort: storage only lets you delete files that were never sent.
    if (f.status !== "error") supabase.storage.from("request-documents").remove([f.path]);
  }

  const ready = files.length > 0 && files.every((f) => f.status === "done");
  const uploading = files.some((f) => f.status === "uploading");

  async function saveDraft() {
    const { error } = await supabase.rpc("save_document_draft", {
      upload_id: uploadId,
      req: request.id,
      upload_note: note.trim() || null,
      files: files.map((f) => ({ path: f.path, name: f.name })),
    });
    if (error) throw new Error(error.message);
  }

  async function verify() {
    if (!ready || busy) return;
    setBusy("verify");
    setProblem(null);
    try {
      await saveDraft();
      const res = await fetch("/api/ai/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id: uploadId }),
      });
      const body = (await res.json().catch(() => ({}))) as { check?: AiCheckResult; status?: "verified" | "failed"; error?: string };
      if (!res.ok || !body.check) throw new Error(body.error ?? "AI Verify couldn't check this right now.");
      setCheck({ result: body.check, status: body.status ?? "failed" });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "AI Verify couldn't check this right now.");
    }
    setBusy(null);
  }

  async function send() {
    if (!ready || busy) return;
    setBusy("send");
    setProblem(null);
    try {
      await saveDraft();
      const { error } = await supabase.rpc("submit_document_upload", { target: uploadId });
      if (error) throw new Error(error.message);
      onSent();
    } catch (e) {
      // Files and note stay, so you can try again.
      setProblem(e instanceof Error ? e.message : "Couldn't send it. Check your connection and try again.");
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <input
        ref={attach}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      {/* On phones this opens the camera; on a computer it opens the file picker. */}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />

      {files.length < DOC_FILES_MAX && (
        <div className="rounded-2xl border-2 border-dashed border-brand/40 bg-tint p-4">
          <p className="font-bold text-ink">{replacing ? "Replace what you sent" : `Upload ${request.title}`}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            PDF, photos, Word, Excel, PowerPoint, CSV or text. Up to {DOC_FILES_MAX} files, 15 MB each.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => attach.current?.click()}
              className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
            >
              <PaperclipIcon className="h-4 w-4" />
              Attach a File
            </button>
            <button
              type="button"
              onClick={() => camera.current?.click()}
              className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
            >
              <CameraIcon className="h-4 w-4" />
              Take a Photo
            </button>
          </div>
        </div>
      )}

      {files.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Files to send">
          {files.map((f) => (
            <li key={f.key} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
                <FileIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{f.name}</span>
                {f.status === "uploading" ? (
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-label={`Uploading ${f.name}`}>
                    <span className="block h-full rounded-full bg-leaf" style={{ width: `${Math.round(f.progress * 100)}%` }} />
                  </span>
                ) : f.status === "error" ? (
                  <span className="block text-[13px] font-semibold text-warn">{f.error}</span>
                ) : (
                  <span className="block text-[13px] text-muted">{fileSize(f.size)} · Uploaded</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => remove(f)}
                aria-label={`Remove ${f.name}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist hover:text-ink"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-sm font-bold">
          <span>
            Note <span className="font-medium text-muted">· Optional</span>
          </span>
          <span className="font-medium text-muted">
            {note.length}/{NOTE_MAX}
          </span>
        </span>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value.slice(0, NOTE_MAX));
          }}
          rows={2}
          placeholder="Anything the requester should know"
          className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none placeholder:text-muted focus:border-brand focus:ring-3 focus:ring-brand/15"
        />
      </label>

      {check && <AiResult check={check.result} status={check.status} />}

      {problem && (
        <p role="alert" className="rounded-xl bg-butter px-3.5 py-2.5 text-sm font-semibold text-honey">
          {problem}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              files.forEach((f) => f.abort?.());
              onCancel();
            }}
            disabled={busy !== null}
            className="mr-auto h-11 rounded-xl px-2 text-sm font-bold text-muted hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={verify}
          disabled={!ready || busy !== null}
          title="Optional: AI checks it matches the request before you send it (you can also run it after sending)"
          className="flex h-12 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-tint disabled:opacity-50"
        >
          <BoltIcon className="h-4 w-4 text-brand" />
          {busy === "verify" ? "Checking…" : check ? "Check Again" : "AI Verify"}
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!ready || busy !== null}
          className="h-12 rounded-xl bg-brand px-5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy === "send" ? "Sending…" : uploading ? "Uploading…" : "Submit Document"}
        </button>
      </div>
    </div>
  );
}

/** Can't Provide: say why instead of leaving the request hanging. */
export function CantProvide({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [openForm, setOpenForm] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!openForm) {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <button type="button" onClick={() => setOpenForm(true)} className="h-11 text-sm font-bold text-muted underline hover:text-ink">
          Can&apos;t Provide
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-2xl bg-mist p-4">
      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-sm font-bold">
          <span>
            Why can&apos;t you provide it? <span className="text-warn">*</span>
          </span>
          <span className="font-medium text-muted">
            {reason.length}/{REASON_MAX}
          </span>
        </span>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
          rows={2}
          placeholder="e.g. I paid in cash and didn't get a receipt."
          className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none placeholder:text-muted focus:border-brand focus:ring-3 focus:ring-brand/15"
        />
      </label>
      {problem && <p className="mt-1.5 text-sm font-semibold text-warn">{problem}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !reason.trim()}
          onClick={async () => {
            setBusy(true);
            setProblem(null);
            const { error } = await supabase.rpc("cant_provide_document", { req: requestId, reason: reason.trim() });
            setBusy(false);
            if (error) setProblem(error.message);
            else onDone();
          }}
          className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send Reason"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpenForm(false)}
          className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ReasonBox({ title, text, tone = "warn" }: { title: string; text: string; tone?: "warn" | "muted" }) {
  return (
    <div className={`mt-3 rounded-2xl px-4 py-3 ${tone === "warn" ? "bg-butter" : "bg-mist"}`}>
      <p className={`text-sm font-bold ${tone === "warn" ? "text-honey" : "text-ink"}`}>{title}</p>
      <p className="mt-0.5 text-sm whitespace-pre-wrap text-ink">{text}</p>
    </div>
  );
}

/* ---------- An upload: its files, AI Verify, and review (the requester) ---------- */

const UPLOAD_STATUS: Record<DocUpload["status"], { label: string; className: string }> = {
  draft: { label: "Not sent", className: "bg-mist text-muted" },
  submitted: { label: "Ready to review", className: "bg-butter-strong text-[#5C4A0B]" },
  accepted: { label: "Accepted", className: "bg-brand text-white" },
  rejected: { label: "Rejected", className: "bg-butter text-honey" },
  replaced: { label: "Replaced", className: "bg-mist text-muted" },
};

/** The small badge on an upload: AI Verified, or AI Verification Failed. */
export function AiBadge({ status }: { status: DocUpload["ai_status"] }) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-white">
        <CheckIcon className="h-3.5 w-3.5" />
        AI Verified
      </span>
    );
  }
  if (status === "failed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-butter px-2.5 py-0.5 text-xs font-bold text-honey">AI Verification Failed</span>;
  }
  return null;
}

export function UploadCard({
  upload,
  chatId,
  requestId,
  who,
  canReview,
  canVerify,
  onChanged,
}: {
  upload: DocUpload;
  chatId: string;
  requestId: string;
  who: string;
  /** The requester, while it waits for review: Accept and Reject. */
  canReview: boolean;
  /** The requester or the person who sent it, while it waits for review: AI Verify. */
  canVerify: boolean;
  onChanged: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [verifying, setVerifying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const st = UPLOAD_STATUS[upload.status];
  const verified = upload.ai_status === "verified";
  const unopened = upload.files.filter((f) => !f.viewed);
  // Not AI Verified: open every file before accepting (the database checks this too).
  const mustOpen = canReview && !verified && unopened.length > 0;

  async function verify() {
    setVerifying(true);
    setProblem(null);
    const res = await fetch("/api/ai/document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upload_id: upload.id }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { check?: AiCheckResult; error?: string }) : {};
    setVerifying(false);
    if (res?.ok && body.check) onChanged(); // the saved result shows for both people
    else setProblem(body.error ?? "AI Verify couldn't check this right now. Check it yourself instead.");
  }

  async function review(decision: "accept" | "reject") {
    setBusy(true);
    setProblem(null);
    const { error } = await supabase.rpc("review_document_upload", {
      target: upload.id,
      decision,
      reason: decision === "reject" ? reason.trim() : null,
    });
    setBusy(false);
    if (error) setProblem(error.message);
    else {
      setRejecting(false);
      onChanged();
    }
  }

  return (
    <article className="rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-bold">
          {who === "You" ? "You sent" : `${who} sent`}{" "}
          <span className="font-medium text-muted">· {stamp(upload.submitted_at ?? upload.created_at)}</span>
        </p>
        <AiBadge status={upload.ai_status} />
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${st.className}`}>{st.label}</span>
      </div>
      {upload.note && <p className="mt-1.5 rounded-xl bg-mist px-3 py-2 text-sm whitespace-pre-wrap text-ink">{upload.note}</p>}

      <ul className="mt-3 flex flex-col gap-2" aria-label="Files">
        {upload.files.map((f) => (
          <li key={f.id}>
            <Link href={fileHref(chatId, requestId, f.id)} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-mist">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
                <FileIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{f.name}</span>
                <span className="block text-[13px] text-muted">
                  {fileKindLabel(f)} · {fileSize(f.size_bytes)}
                  {canReview && (f.viewed ? " · Opened" : " · Not opened yet")}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold text-brand">Open</span>
            </Link>
          </li>
        ))}
      </ul>

      {upload.status === "rejected" && upload.review_note && <ReasonBox title="Rejected because" text={upload.review_note} />}

      {upload.ai_result && upload.ai_status && <AiResult check={upload.ai_result} status={upload.ai_status} />}

      {problem && (
        <p role="alert" className="mt-3 rounded-xl bg-butter px-3.5 py-2.5 text-sm font-semibold text-honey">
          {problem}
        </p>
      )}

      {(canVerify || canReview) && !rejecting && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canVerify && (
            <button
              type="button"
              onClick={verify}
              disabled={verifying || busy}
              title="AI checks it matches the request, pulls out the key details and summarizes it"
              className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-tint disabled:opacity-50"
            >
              <BoltIcon className="h-4 w-4 text-brand" />
              {verifying ? "Checking…" : upload.ai_status ? "Check Again" : "AI Verify"}
            </button>
          )}
          {canReview && (
            <>
              <span className="mr-auto" />
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={busy}
                className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-50"
              >
                Reject
              </button>
              <button
                type="button"
                onClick={() => review("accept")}
                disabled={busy || mustOpen}
                title={mustOpen ? "Open each file to check it first" : undefined}
                className="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                <CheckIcon className="h-4 w-4" />
                {busy ? "Saving…" : "Accept"}
              </button>
            </>
          )}
        </div>
      )}
      {mustOpen && !rejecting && (
        <p className="mt-2 text-[13px] text-muted">
          {upload.ai_status === "failed" ? "AI couldn't verify it. " : "It isn't AI Verified. "}
          Open {upload.files.length === 1 ? "the file" : unopened.length === upload.files.length ? "each file" : "the rest of the files"} to check{" "}
          {upload.files.length === 1 ? "it" : "them"} yourself before accepting.
        </p>
      )}

      {canReview && rejecting && (
        <div className="mt-3 rounded-2xl bg-butter p-4">
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
              placeholder="e.g. The total is cut off. Please send the whole receipt."
              className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none placeholder:text-muted focus:border-brand"
            />
          </label>
          <p className="mt-1 text-[13px] text-ink">They&apos;ll see your reason and can upload again.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => review("reject")}
              className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white hover:bg-black disabled:opacity-50"
            >
              {busy ? "Saving…" : "Reject Document"}
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
    </article>
  );
}

/* ---------- AI Verify's result (shown to both the requester and the sender) ---------- */

export function AiResult({ check, status }: { check: AiCheckResult; status: "verified" | "failed" }) {
  const ok = status === "verified";
  return (
    <section aria-label="AI Verify result" className={`mt-3 rounded-2xl border ${ok ? "border-brand/30" : "border-[#E0C266]"} bg-white`}>
      <div className={`flex items-center gap-2.5 rounded-t-2xl px-4 py-3 ${ok ? "bg-tint" : "bg-butter"}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ok ? "bg-brand text-white" : "bg-white text-honey"}`}>
          {ok ? <CheckIcon className="h-4 w-4" /> : <BoltIcon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-extrabold ${ok ? "text-brand" : "text-honey"}`}>{ok ? "AI Verified Successful" : "AI Verification Failed"}</p>
          <p className="text-[13px] text-ink">
            {ok ? "It matches what was asked and has the info needed." : "Please check it manually instead."}
          </p>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-ink">{check.reason}</p>
        {check.looks_like && (
          <p className="mt-1 text-[13px] text-muted">
            Looks like: <span className="font-bold text-ink">{check.looks_like}</span>
          </p>
        )}
        {check.key_details?.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl bg-mist px-3.5 py-3 text-sm">
            {check.key_details.map((d, i) => (
              <div key={i} className="contents">
                <dt className="font-bold text-muted">{d.label}</dt>
                <dd className="break-words text-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {check.summary && (
          <>
            <p className="mt-3 text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Summary</p>
            <p className="mt-1 text-sm text-ink">{check.summary}</p>
          </>
        )}
        {check.transcript && (
          <details className="mt-3 rounded-xl border border-line">
            <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-sm font-bold text-ink">Transcript</summary>
            <pre className="max-h-72 overflow-auto px-3.5 pb-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">{check.transcript}</pre>
          </details>
        )}
        {check.skipped?.length ? <p className="mt-2 text-[13px] text-muted">Couldn&apos;t read: {check.skipped.join(", ")}</p> : null}
        <p className="mt-3 text-[12px] text-muted">An AI check, not proof the document is genuine. The requester decides.</p>
      </div>
    </section>
  );
}
