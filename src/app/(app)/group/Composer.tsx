"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { AtIcon, CloseIcon, FileIcon, PaperclipIcon, SendIcon } from "@/components/app/icons";
import type { createClient } from "@/lib/supabase/client";
import {
  cleanBody,
  FILE_MAX,
  FILE_TYPES,
  FILES_PER_MESSAGE,
  fileSize,
  MESSAGE_MAX,
  removeUnsentFiles,
  uploadChatFile,
  type DraftFile,
  type Outgoing,
} from "./messages";
import { personName, type Member } from "./types";

// The message box at the bottom of a chat: attach, type, @mention, send.
//   Enter sends, Shift+Enter adds a line, and nothing sends while an input method
//   (e.g. Chinese or Japanese typing) is still composing.
//   Files upload as soon as they're picked, with progress; Send waits until all are done.

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export default function Composer({
  supabase,
  conversationId,
  placeholder,
  people,
  onSend,
}: {
  supabase: ReturnType<typeof createClient>;
  conversationId: string;
  placeholder: string;
  /** Who can be @mentioned: the other members of the group, or the other person in a DM. */
  people: Member[];
  /** Hands the message over for sending; the composer is cleared right away. */
  onSend: (message: Outgoing) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<DraftFile[]>([]);
  // The next message's id. Files upload into its folder, and a retry reuses it.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  // Mentions picked from the list: username → user id.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const area = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const aborts = useRef(new Map<string, () => void>());
  const filesNow = useRef(files);
  const ids = useId();

  useEffect(() => {
    filesNow.current = files;
  }, [files]);

  // Leaving the chat with files picked but not sent: stop uploads and delete what was uploaded.
  useEffect(() => {
    const running = aborts.current;
    return () => {
      for (const abort of running.values()) abort();
      const unsent = filesNow.current.filter((f) => f.status === "done").map((f) => f.path);
      removeUnsentFiles(supabase, unsent);
    };
  }, [supabase]);

  // Grow with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const options = mention
    ? people
        .filter((p) => {
          const q = mention.query;
          return !q || personName(p).toLowerCase().includes(q) || p.username.includes(q);
        })
        .slice(0, 6)
    : [];

  const body = cleanBody(text);
  const uploading = files.some((f) => f.status === "uploading");
  const failed = files.some((f) => f.status === "error");
  const tooLong = body.length > MESSAGE_MAX;
  const canSend = (body !== "" || files.length > 0) && !uploading && !failed && !tooLong;
  const hint = tooLong
    ? `Messages can be up to ${MESSAGE_MAX.toLocaleString()} characters.`
    : failed
      ? "A file didn't upload. Retry it or remove it to send."
      : uploading
        ? "Send is ready once your files finish uploading."
        : null;

  /* ---------- Files ---------- */

  const update = (key: string, change: Partial<DraftFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));

  function start(draft: DraftFile) {
    const upload = uploadChatFile(supabase, draft.path, draft.file, (progress) => update(draft.key, { progress }));
    aborts.current.set(draft.key, upload.abort);
    upload.promise
      .then(() => update(draft.key, { status: "done", progress: 1, error: undefined }))
      .catch((e: Error) => {
        if (e.message !== "Cancelled") update(draft.key, { status: "error", error: e.message });
      })
      .finally(() => aborts.current.delete(draft.key));
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const incoming = [...list];
    const room = FILES_PER_MESSAGE - files.length;
    const errors: string[] = [];
    if (incoming.length > room) errors.push(`You can attach up to ${FILES_PER_MESSAGE} files per message.`);
    const ok: DraftFile[] = [];
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      if (!FILE_TYPES.includes(file.type)) errors.push(`“${file.name}” isn't a JPG, PNG, WebP or PDF.`);
      else if (file.size > FILE_MAX) errors.push(`“${file.name}” is over 10 MB.`);
      else {
        const key = crypto.randomUUID();
        ok.push({
          key,
          file,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
          path: `${conversationId}/${draftId}/${key}.${EXT[file.type]}`,
          status: "uploading",
          progress: 0,
        });
      }
    }
    // Problems show before anything uploads; only the files that passed go up.
    setProblem(errors.length ? errors.join(" ") : null);
    if (!ok.length) return;
    setFiles((current) => [...current, ...ok]);
    ok.forEach(start);
  }

  function removeFile(f: DraftFile) {
    aborts.current.get(f.key)?.();
    if (f.status === "done") removeUnsentFiles(supabase, [f.path]);
    if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles((list) => list.filter((x) => x.key !== f.key));
    setProblem(null);
  }

  function retryFile(f: DraftFile) {
    update(f.key, { status: "uploading", progress: 0, error: undefined });
    start({ ...f, status: "uploading", progress: 0 });
  }

  /* ---------- Mentions ---------- */

  function findMention(value: string, caret: number) {
    const match = value.slice(0, caret).match(/(?:^|\s)@(\w{0,20})$/);
    if (match) {
      setMention({ start: caret - match[1].length - 1, query: match[1].toLowerCase() });
      setActive(0);
    } else setMention(null);
  }

  function putCaret(at: number) {
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(at, at);
    });
  }

  function choose(person: Member) {
    if (!mention) return;
    const caret = area.current?.selectionStart ?? text.length;
    const insert = `@${person.username} `;
    setText(text.slice(0, mention.start) + insert + text.slice(caret));
    setPicked((p) => ({ ...p, [person.username]: person.user_id }));
    setMention(null);
    putCaret(mention.start + insert.length);
  }

  function openMentions() {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${spacer}@${text.slice(caret)}`;
    setText(next);
    setMention({ start: caret + spacer.length, query: "" });
    setActive(0);
    putCaret(caret + spacer.length + 1);
  }

  /* ---------- Sending ---------- */

  function send() {
    if (!canSend) return;
    // Only people picked from the list whose @username is still in the text.
    const mentions = [
      ...new Set(
        Object.entries(picked)
          .filter(([username]) => new RegExp(`(^|[^\\w])@${username}(?!\\w)`).test(body))
          .map(([, id]) => id),
      ),
    ];
    onSend({ id: draftId, body, mentions, files, created_at: new Date().toISOString(), status: "sending" });
    // Clear only what was just sent; anything typed after this is a new message.
    setText("");
    setFiles([]);
    setPicked({});
    setMention(null);
    setProblem(null);
    setDraftId(crypto.randomUUID());
  }

  const listId = `${ids}-mentions`;

  return (
    <div className="relative shrink-0 px-4 pt-2 pb-4 sm:px-5">
      {/* @mention suggestions, above the box */}
      {mention && (
        <div className="absolute inset-x-4 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-line bg-white shadow-xl shadow-night/10 sm:inset-x-5">
          {options.length ? (
            <ul id={listId} role="listbox" aria-label="People to mention" className="max-h-64 overflow-y-auto p-1.5">
              {options.map((p, i) => (
                <li
                  key={p.user_id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()} // keep the cursor in the box
                  onClick={() => choose(p)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 ${i === active ? "bg-tint" : ""}`}
                >
                  <Avatar src={p.avatar_url} name={personName(p)} seed={p.user_id} size={32} />
                  <span className="min-w-0 truncate text-sm font-bold">{personName(p)}</span>
                  <span className="min-w-0 truncate text-[13px] text-muted">@{p.username}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p id={listId} role="status" className="px-4 py-3 text-sm text-muted">
              {people.length ? "No one here matches that name." : "There's no one else here to mention yet."}
            </p>
          )}
        </div>
      )}

      {/* Picked files */}
      {files.length > 0 && (
        <ul aria-label="Attached files" className="mb-2.5 flex gap-2 overflow-x-auto pb-1">
          {files.map((f) => (
            <li key={f.key} className="relative flex w-[200px] shrink-0 items-center gap-2.5 rounded-xl border border-line bg-white p-2">
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview of a picked file
                <img src={f.preview} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-tint text-brand">
                  <FileIcon className="h-5 w-5" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-bold">{f.file.name}</span>
                {f.status === "error" ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="font-semibold text-warn">Failed</span>
                    <button type="button" onClick={() => retryFile(f)} className="font-bold text-brand underline">
                      Retry
                    </button>
                  </span>
                ) : f.status === "uploading" ? (
                  <span
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-mist"
                    role="progressbar"
                    aria-label={`Uploading ${f.file.name}`}
                    aria-valuenow={Math.round(f.progress * 100)}
                  >
                    <span
                      className="block h-full rounded-full bg-leaf transition-[width]"
                      style={{ width: `${Math.round(f.progress * 100)}%` }}
                    />
                  </span>
                ) : (
                  <span className="text-xs text-muted">{fileSize(f.file.size)}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => removeFile(f)}
                aria-label={`Remove ${f.file.name}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-mist hover:text-ink"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {(problem || hint) && (
        <p role={problem ? "alert" : "status"} className={`mb-2 text-[13px] font-semibold ${problem ? "text-warn" : "text-muted"}`}>
          {problem ?? hint}
        </p>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={FILE_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={files.length >= FILES_PER_MESSAGE}
          aria-label="Attach photos or PDFs"
          title="Attach photos or PDFs (up to 5, 10 MB each)"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-line bg-white text-ink hover:bg-mist disabled:text-muted disabled:opacity-60"
        >
          <PaperclipIcon className="h-5 w-5" />
        </button>

        {/* The box. A layer behind the text tints each @mention. */}
        <div className="relative min-w-0 flex-1 rounded-[14px] border border-line bg-mist focus-within:border-brand">
          <div
            ref={backdrop}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 text-[15px] leading-6 break-words whitespace-pre-wrap text-transparent"
          >
            {highlight(text, picked)}
            {"\n"}
          </div>
          <textarea
            ref={area}
            value={text}
            rows={1}
            maxLength={MESSAGE_MAX + 200}
            placeholder={placeholder}
            aria-label="Message"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={mention !== null}
            aria-controls={mention ? listId : undefined}
            aria-activedescendant={mention && options.length ? `${listId}-${active}` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              findMention(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => findMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onScroll={(e) => {
              if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onBlur={() => setMention(null)}
            onKeyDown={(e) => {
              const composing = e.nativeEvent.isComposing || e.keyCode === 229;
              if (mention && !composing) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
                if (options.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                  e.preventDefault();
                  setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
                  return;
                }
                if (options.length && (e.key === "Enter" || e.key === "Tab")) {
                  e.preventDefault();
                  choose(options[active]);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !composing) {
                e.preventDefault();
                send();
              }
            }}
            className="relative block max-h-40 w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-6 text-ink outline-none placeholder:text-muted"
          />
        </div>

        <button
          type="button"
          onClick={openMentions}
          aria-label="Mention someone"
          title="Mention someone"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-line bg-white text-ink hover:bg-mist"
        >
          <AtIcon className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-brand text-white hover:bg-brand-hover disabled:bg-line disabled:text-muted"
        >
          <SendIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

/** The text with each picked @username wrapped in a tinted mark (for the layer behind the box). */
function highlight(text: string, picked: Record<string, string>) {
  const names = Object.keys(picked);
  if (!names.length) return text;
  const parts = text.split(new RegExp(`(@(?:${names.join("|")})(?!\\w))`, "g"));
  return parts.map((part, i) =>
    part.startsWith("@") && names.includes(part.slice(1)) ? (
      <mark key={i} className="rounded bg-sage/35 text-transparent">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
