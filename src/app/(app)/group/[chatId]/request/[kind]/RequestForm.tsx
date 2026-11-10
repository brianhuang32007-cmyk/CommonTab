"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, FileIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { titleOf, type Conversation } from "../../../types";
import PaymentForm from "./PaymentForm";

// The Request Payment and Request Document pages, opened from the buttons above a chat's
// message box. Request Payment is the full form (PaymentForm). Request Document only asks
// for a title so far, and isn't saved or sent yet.

const TITLE_MAX = 80;

type Kind = "payment" | "document";
const COPY: Record<Kind, { heading: string; placeholder: string; who: string }> = {
  payment: { heading: "Request Payment", placeholder: "e.g. Tahoe cabin", who: "Only the owner and organizers can request a payment." },
  document: { heading: "Request Document", placeholder: "e.g. Gas receipt", who: "Anyone in the chat can request a document." },
};

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "ready"; chat: Conversation };

export default function RequestForm() {
  const params = useParams<{ chatId: string; kind: string }>();
  const kind: Kind | null = params.kind === "payment" || params.kind === "document" ? params.kind : null;
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [title, setTitle] = useState("");

  useEffect(() => {
    let live = true;
    supabase.rpc("my_conversations").then(({ data, error }) => {
      if (!live) return;
      if (error) return setState({ status: "error" });
      const chat = ((data ?? []) as Conversation[]).find((c) => c.id === params.chatId);
      setState(chat ? { status: "ready", chat } : { status: "missing" });
    });
    return () => {
      live = false;
    };
  }, [supabase, params.chatId]);

  if (!kind || state.status === "missing") {
    return <Notice title="This page isn't available" text="The chat may have been deleted, or you're no longer in it." back="/group" />;
  }
  if (state.status === "error") {
    return <Notice title="Couldn't load this chat" text="Check your connection and try again." back="/group" />;
  }
  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading…
      </p>
    );
  }

  const { chat } = state;
  const back = `/group?chat=${chat.id}`;
  const chatTitle = titleOf(chat, me);
  const myRole = chat.members.find((m) => m.user_id === me)?.role;
  const copy = COPY[kind];

  // The button is hidden for others too; this covers a link opened directly.
  if (kind === "payment" && !(chat.kind === "group" && (myRole === "owner" || myRole === "organizer"))) {
    return <Notice title="Only organizers can request payments" text={`In ${chatTitle}, ${copy.who.toLowerCase()}`} back={back} />;
  }

  if (kind === "payment") return <PaymentForm chat={chat} me={me} chatTitle={chatTitle} />;
  const Icon = FileIcon;

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {chatTitle}
      </Link>

      <form onSubmit={(e) => e.preventDefault()} className="mt-2 rounded-3xl border border-line bg-white p-6 sm:p-7">
        <div className="flex items-center gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[26px] font-extrabold tracking-tight">{copy.heading}</h2>
            <p className="truncate text-sm text-muted">In {chatTitle}</p>
          </div>
        </div>

        <label className="mt-6 flex flex-col gap-1.5">
          <span className="flex justify-between text-sm font-bold">
            <span>
              Title <span className="text-warn">*</span>
            </span>
            <span className="font-medium text-muted">
              {title.length}/{TITLE_MAX}
            </span>
          </span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            maxLength={TITLE_MAX}
            required
            placeholder={copy.placeholder}
            className="h-12 rounded-xl border border-line bg-white px-3.5 text-base outline-none placeholder:text-muted focus:border-brand focus:ring-3 focus:ring-brand/15"
          />
        </label>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5 border-t border-line pt-5">
          <p className="mr-auto text-[13px] text-muted">More details and sending come next.</p>
          <Link href={back} className="flex h-12 items-center rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist">
            Cancel
          </Link>
          <button
            type="submit"
            disabled
            title="Sending requests comes next"
            className="h-12 rounded-xl bg-brand px-5 font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            Send Request
          </button>
        </div>
      </form>
    </div>
  );
}

function Notice({ title, text, back }: { title: string; text: string; back: string }) {
  return (
    <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
      <p className="text-lg font-extrabold">{title}</p>
      <p className="mt-1.5 text-sm text-muted">{text}</p>
      <Link
        href={back}
        className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
      >
        Back to the chat
      </Link>
    </div>
  );
}
