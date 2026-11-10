"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { ArrowUpIcon, BoltIcon, CameraIcon, CloseIcon, ContactsIcon, DocumentIcon, PaperclipIcon, PlusIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { groupPictureLinks } from "@/lib/groupPictures";
import { createClient } from "@/lib/supabase/client";
import { AssistantMessage, type ChatEntry } from "./blocks";
import { FILE_TYPES, fileProblem as checkFile, useAiChat } from "./useAiChat";

// The CommonTab AI page: a chat with the assistant, quick actions, and a box to ask in.
// Sending and streaming answers live in useAiChat (shared with the dashboard's chat window).

type Group = { id: string; name: string; picture_url: string | null; avatar_gradient: number | null };

export default function AiView() {
  const { firstName } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const { entries, setEntries, asking, remaining, send: ask } = useAiChat();
  const [text, setText] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null); // null while loading
  const [groupsFailed, setGroupsFailed] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLDivElement>(null);

  // Your groups, for the "which group?" chip.
  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc("my_conversations");
      if (error) {
        if (live) setGroupsFailed(true);
        return;
      }
      const rows = (
        (data ?? []) as { id: string; kind: string; name: string | null; picture_path: string | null; avatar_gradient: number | null }[]
      ).filter((c) => c.kind === "group");
      const links = await groupPictureLinks(
        supabase,
        rows.map((r) => r.picture_path),
      );
      if (live) {
        setGroups(
          rows.map((r) => ({
            id: r.id,
            name: r.name ?? "Group",
            picture_url: r.picture_path ? (links.get(r.picture_path) ?? null) : null,
            avatar_gradient: r.avatar_gradient,
          })),
        );
      }
    })();
    return () => {
      live = false;
    };
  }, [supabase]);

  // Close the group list on a click outside or Escape.
  useEffect(() => {
    if (!picking) return;
    const onPointer = (e: PointerEvent) => !picker.current?.contains(e.target as Node) && setPicking(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicking(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [picking]);

  // Grow the box with the text, up to about six lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  // Follow the newest message.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const question = text.trim();
  const canSend = (question !== "" || file !== null) && !asking;

  function send() {
    if (!canSend) return;
    ask({ question, file, group });
    setText("");
    setFile(null);
    setFileProblem(null);
  }

  function suggest(prompt: string) {
    setText(prompt);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  return (
    <div className="flex h-[calc(100dvh-208px)] min-h-[460px] flex-col lg:h-[calc(100dvh-160px)]">
      {/* Conversation */}
      <div ref={scroller} role="log" aria-label="Conversation with CommonTab AI" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col justify-end gap-6 px-1 py-4">
          {entries.length === 0 ? (
            <Welcome firstName={firstName} onPreview={() => setEntries(previewEntries())} />
          ) : (
            entries.map((e) =>
              e.role === "user" ? (
                <div key={e.id} className="flex flex-col items-end gap-1">
                  {(e.group || e.file) && (
                    <p className="flex flex-wrap justify-end gap-1.5 text-xs font-bold text-brand">
                      {e.group && <span className="rounded-full bg-tint px-2.5 py-1">{e.group}</span>}
                      {e.file && <span className="rounded-full bg-tint px-2.5 py-1">{e.file}</span>}
                    </p>
                  )}
                  {e.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview of your own photo
                    <img
                      src={e.preview}
                      alt={e.file ?? "Attached photo"}
                      className="max-h-48 max-w-[220px] rounded-2xl border border-line object-cover"
                    />
                  )}
                  {e.text && (
                    <p className="max-w-[78%] rounded-3xl bg-tint px-5 py-3 text-[15px] leading-6 break-words whitespace-pre-wrap text-ink">
                      {e.text}
                    </p>
                  )}
                  <time dateTime={e.at} className="px-1 text-xs text-muted">
                    {new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </time>
                </div>
              ) : (
                <AssistantMessage key={e.id} blocks={e.blocks} state={e.state} />
              ),
            )
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[880px] shrink-0">
        {/* Quick actions */}
        <div className="flex gap-2.5 overflow-x-auto px-1 pt-2 pb-3 sm:justify-center">
          <QuickAction
            icon={<CameraIcon className="h-5 w-5" />}
            label="Scan a receipt"
            onClick={() => {
              suggest("Read this receipt and split it evenly.");
              fileInput.current?.click();
            }}
          />
          <QuickAction
            icon={<ContactsIcon className="h-5 w-5" />}
            label="Check group progress"
            onClick={() => suggest(group ? `How is ${group.name} doing? Who still owes?` : "How are my groups doing? Who still owes?")}
          />
          <QuickAction
            icon={<DocumentIcon className="h-5 w-5" />}
            label="Draft a request"
            onClick={() => suggest("Draft a payment request for ")}
          />
        </div>

        {/* Ask box */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="rounded-3xl border border-line bg-white px-4 pt-3.5 pb-3 shadow-sm focus-within:border-brand"
        >
          <label className="sr-only" htmlFor="ask">
            Ask CommonTab AI
          </label>
          <textarea
            id="ask"
            ref={area}
            value={text}
            rows={1}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter asks; Shift+Enter adds a line; never mid-composition (Chinese, Japanese…).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask CommonTab anything…"
            className="block max-h-40 w-full resize-none bg-transparent px-1 text-[16px] leading-6 text-ink outline-none placeholder:text-muted"
          />
          {fileProblem && (
            <p role="alert" className="mt-1.5 px-1 text-[13px] font-semibold text-warn">
              {fileProblem}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={FILE_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (!picked) return;
                const problem = checkFile(picked);
                if (problem) return setFileProblem(problem);
                setFileProblem(null);
                setFile(picked);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-label="Attach a photo or PDF"
              title="Attach a photo (up to 10 MB) or a PDF (up to 3 MB)"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-mist text-ink hover:bg-tint"
            >
              <PaperclipIcon className="h-5 w-5" />
            </button>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {file && <Chip label={file.name} onRemove={() => setFile(null)} removeLabel={`Remove ${file.name}`} />}
              {group ? (
                <Chip label={group.name} onRemove={() => setGroup(null)} removeLabel={`Stop asking about ${group.name}`} />
              ) : (
                <div ref={picker} className="relative">
                  <button
                    type="button"
                    onClick={() => setPicking((p) => !p)}
                    aria-expanded={picking}
                    aria-haspopup="listbox"
                    className="flex h-9 items-center gap-1.5 rounded-full border border-dashed border-line px-3 text-sm font-semibold text-muted hover:border-brand hover:text-brand"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add group
                  </button>
                  {picking && (
                    <ul
                      role="listbox"
                      aria-label="Ask about a group"
                      className="absolute bottom-full left-0 z-20 mb-2 max-h-64 w-64 overflow-y-auto rounded-2xl border border-line bg-white p-1.5 shadow-xl shadow-night/10"
                    >
                      {groupsFailed ? (
                        <li role="alert" className="px-3 py-2.5 text-sm text-muted">
                          Couldn&apos;t load your groups. Refresh to try again.
                        </li>
                      ) : groups === null ? (
                        <li role="status" className="px-3 py-2.5 text-sm text-muted">
                          Loading your groups…
                        </li>
                      ) : groups.length ? (
                        groups.map((g) => (
                          <li key={g.id} role="option" aria-selected={false}>
                            <button
                              type="button"
                              onClick={() => {
                                setGroup(g);
                                setPicking(false);
                                area.current?.focus();
                              }}
                              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-bold hover:bg-mist"
                            >
                              <Avatar src={g.picture_url} name={g.name} seed={g.id} size={28} shape="square" gradient={g.avatar_gradient} />
                              <span className="truncate">{g.name}</span>
                            </button>
                          </li>
                        ))
                      ) : (
                        <li className="px-3 py-2.5 text-sm text-muted">You&apos;re not in any groups yet.</li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSend}
              aria-label="Ask"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-hover disabled:bg-line disabled:text-muted"
            >
              <ArrowUpIcon className="h-5 w-5" />
            </button>
          </div>
        </form>
        <p className="px-2 pt-2 text-center text-xs text-muted">
          CommonTab AI drafts and suggests. You always check and confirm before anything is sent.
          {remaining !== null && ` ${remaining} ${remaining === 1 ? "question" : "questions"} left today.`}
        </p>
      </div>
    </div>
  );
}

function Welcome({ firstName, onPreview }: { firstName: string; onPreview: () => void }) {
  return (
    <div className="m-auto flex max-w-md flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white">
        <BoltIcon className="h-7 w-7" />
      </span>
      <p className="mt-4 text-2xl font-extrabold">Hi {firstName}, how can I help?</p>
      <p className="mt-1.5 text-sm text-muted">
        Ask about your groups, what you owe and who still needs to pay. Pick a group below to focus on it.
      </p>
      {/* Design check only: never shown on the live site. */}
      {process.env.NODE_ENV === "development" && (
        <button type="button" onClick={onPreview} className="mt-4 text-sm font-bold text-brand underline">
          Preview an example answer (localhost only)
        </button>
      )}
    </div>
  );
}

/** Made-up example for checking the layout on localhost. Not real data. */
function previewEntries(): ChatEntry[] {
  const at = new Date().toISOString();
  return [
    { id: "p1", role: "user", text: "What do I owe for the Tahoe trip?", at, group: "Tahoe Cabin Trip", file: null },
    {
      id: "p2",
      role: "assistant",
      at,
      blocks: [
        { type: "text", text: "You have $85 remaining for the Tahoe cabin. Your share is confirmed and due November 13." },
        {
          type: "payment",
          title: "Tahoe cabin booking",
          amountCents: 8500,
          amountLabel: "Your remaining share",
          status: "confirmed",
          due: "2026-11-13",
          payableTo: "Brian",
          href: "#",
        },
        { type: "source", text: "Based on your Tahoe Cabin Trip requests" },
        { type: "text", text: "Alex's gas receipt is also awaiting upload." },
        { type: "document", title: "Gas receipt", detail: "Requested from Alex", href: "#" },
      ],
    },
  ];
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 shrink-0 items-center gap-2.5 rounded-full border border-sage/60 bg-citron px-5 text-[15px] font-semibold text-ink hover:bg-tint"
    >
      <span className="text-[#3E4A43]">{icon}</span>
      {label}
    </button>
  );
}

function Chip({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <span className="flex h-9 max-w-[240px] items-center gap-1 rounded-full bg-tint pr-1 pl-3.5 text-sm font-semibold text-brand">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-white/70"
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
