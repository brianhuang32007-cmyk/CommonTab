"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { titleOf, type Conversation } from "../../../types";
import DocumentForm from "./DocumentForm";
import PaymentForm from "./PaymentForm";

// The Request Payment and Request Document pages, opened from the buttons above a chat's
// message box: PaymentForm (owner and organizers, groups only) and DocumentForm (anyone,
// groups and DMs).

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
  return <DocumentForm chat={chat} me={me} chatTitle={chatTitle} />;
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
