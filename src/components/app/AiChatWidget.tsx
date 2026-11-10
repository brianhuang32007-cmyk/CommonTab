"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAiChat } from "@/app/(app)/ai/useAiChat";
import { ArrowOutIcon, ArrowUpIcon, BoltIcon, ChevronDownIcon } from "./icons";
import { useProfile } from "./ProfileContext";

// "Ask CommonTab AI" on the dashboard: a button that opens a small chat window right there.
// It shares the conversation with the CommonTab AI page (useAiChat), so the AI remembers
// everything, but the window only shows what's asked during this visit to the dashboard.
// The full history is on the CommonTab AI page (the arrow in the header).

export default function AiChatWidget() {
  const { firstName } = useProfile();
  const { entries, asking, remaining, send } = useAiChat();
  // Where this visit started: earlier messages stay on the AI page only.
  const [start] = useState(() => entries.length);
  const shown = entries.slice(start);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const reopen = useRef(false);

  function close() {
    setOpen(false);
    reopen.current = true;
  }

  // Opening puts the cursor in the box; closing puts focus back on the button.
  useEffect(() => {
    if (open) box.current?.focus();
    else if (reopen.current) launcher.current?.focus();
  }, [open]);

  // Escape closes the window.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Follow the newest message.
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  // Grow the box with the text, up to about four lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [text, open]);

  const canSend = text.trim() !== "" && !asking;
  function submit() {
    if (!canSend) return;
    send({ question: text });
    setText("");
  }

  if (!open) {
    return (
      <button
        ref={launcher}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed right-5 bottom-5 z-20 flex h-[52px] items-center gap-2 rounded-full bg-brand px-5 font-bold text-white shadow-lg shadow-night/20 transition hover:bg-brand-hover"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-butter-strong text-[#5C4A0B]">
          <BoltIcon className="h-4 w-4" />
        </span>
        Ask CommonTab AI
      </button>
    );
  }

  return (
    <section
      role="dialog"
      aria-label="Chat with CommonTab AI"
      className="fixed right-3 bottom-3 z-30 flex h-[min(560px,calc(100dvh-96px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl border border-line bg-white shadow-2xl shadow-night/20 sm:right-5 sm:bottom-5"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 bg-brand px-4 py-3.5 text-white">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15">
          <BoltIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold">CommonTab AI</p>
          <p className="truncate text-sm text-white/85">Groups, chats &amp; receipts</p>
        </div>
        <Link
          href="/ai"
          aria-label="See the full history on the CommonTab AI page"
          title="See the full history on the CommonTab AI page"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
        >
          <ArrowOutIcon className="h-5 w-5" />
        </Link>
        <button
          type="button"
          onClick={close}
          aria-label="Close the chat"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-white/15"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Conversation */}
      <div
        ref={log}
        role="log"
        aria-label="Conversation with CommonTab AI"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-mist px-4 py-4"
      >
        <Bubble from="ai">Hey {firstName}! Need help with a group, a chat or a receipt?</Bubble>
        {start > 0 && shown.length === 0 && (
          <p className="text-center text-xs text-muted">
            Earlier questions are on the{" "}
            <Link href="/ai" className="font-bold text-brand underline">
              CommonTab AI page
            </Link>
            .
          </p>
        )}
        {shown.map((e) =>
          e.role === "user" ? (
            <Bubble key={e.id} from="me">
              {e.text || (e.file ? `Sent ${e.file}` : "")}
            </Bubble>
          ) : (
            <Bubble key={e.id} from="ai" thinking={e.state === "thinking"}>
              {e.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n")}
            </Bubble>
          ),
        )}
      </div>

      {/* Ask box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="shrink-0 border-t border-line bg-white px-3.5 pt-3 pb-3"
      >
        <div className="flex items-end gap-2 rounded-[26px] border border-line bg-mist py-1.5 pr-1.5 pl-4 focus-within:border-brand">
          <label htmlFor="ai-widget-box" className="sr-only">
            Ask CommonTab AI
          </label>
          <textarea
            id="ai-widget-box"
            ref={box}
            value={text}
            rows={1}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter asks; Shift+Enter adds a line; never mid-composition (Chinese, Japanese…).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask CommonTab AI…"
            className="block max-h-24 min-w-0 flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Ask"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white hover:bg-brand-hover disabled:bg-line disabled:text-muted"
          >
            <ArrowUpIcon className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-center text-[11px] text-muted">
          Drafts and suggests only.{remaining !== null && ` ${remaining} ${remaining === 1 ? "question" : "questions"} left today.`}
        </p>
      </form>
    </section>
  );
}

function Bubble({ from, thinking = false, children }: { from: "ai" | "me"; thinking?: boolean; children: React.ReactNode }) {
  if (from === "me") {
    return (
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap text-white">
        {children}
      </p>
    );
  }
  return (
    <p className="max-w-[88%] self-start rounded-2xl rounded-bl-md border border-line bg-white px-4 py-2.5 text-[15px] leading-6 break-words whitespace-pre-wrap text-ink">
      {thinking ? (
        <span role="status" className="flex items-center gap-2 text-muted">
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-sage" />
          Thinking…
        </span>
      ) : (
        children
      )}
    </p>
  );
}
