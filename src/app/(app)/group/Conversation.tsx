"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { ChevronLeftIcon, InfoIcon } from "@/components/app/icons";
import { useNotifications } from "@/components/app/NotificationsContext";
import type { createClient } from "@/lib/supabase/client";
import Composer from "./Composer";
import MessageList from "./MessageList";
import { removeUnsentFiles, useMessages, type Message, type Outgoing } from "./messages";
import { memberLabel, otherMember, titleOf, type Conversation as Chat } from "./types";

type Tab = "chat" | "requests" | "files";

// The middle column: header, Chat / Requests / Files tabs, messages and the message box.
export default function Conversation({
  supabase,
  chat,
  me,
  onBack,
  onDetails,
  onRead,
  className,
}: {
  supabase: ReturnType<typeof createClient>;
  chat: Chat;
  me: string;
  onBack: () => void;
  onDetails: () => void;
  /** Called after unread mentions here were marked read, so the list can drop its "@ You". */
  onRead: () => void;
  className: string;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const state = useMessages(supabase, chat.id);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [stick, setStick] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [visible, setVisible] = useState(true);
  const marked = useRef<number>(-1);
  const { add } = state;
  const { refresh: refreshAlerts } = useNotifications();

  /* ---------- Sending ---------- */

  // Sends (or re-sends) one message. The id never changes, so the database keeps one copy.
  const deliver = useCallback(
    async (o: Outgoing) => {
      setOutgoing((list) => list.map((x) => (x.id === o.id ? { ...x, status: "sending", error: undefined } : x)));
      const { data, error } = await supabase.rpc("send_message", {
        msg_id: o.id,
        target: chat.id,
        msg_body: o.body,
        mention_ids: o.mentions,
        files: o.files.map((f) => ({ path: f.path, name: f.file.name })),
      });
      if (error || !data) {
        setOutgoing((list) =>
          list.map((x) => (x.id === o.id ? { ...x, status: "failed", error: error?.message ?? "Check your connection." } : x)),
        );
        return;
      }
      add(data as Message);
      setOutgoing((list) => {
        list.find((x) => x.id === o.id)?.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        return list.filter((x) => x.id !== o.id);
      });
    },
    [supabase, chat.id, add],
  );

  function send(o: Outgoing) {
    setOutgoing((list) => [...list, o]);
    setStick((n) => n + 1);
    deliver(o);
  }

  function remove(o: Outgoing) {
    removeUnsentFiles(
      supabase,
      o.files.map((f) => f.path),
    );
    o.files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setOutgoing((list) => list.filter((x) => x.id !== o.id));
  }

  /* ---------- Read position ---------- */
  // Marked read only while this chat is open, the tab is visible and you're at the newest messages.

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  const last = state.messages.length ? state.messages[state.messages.length - 1] : null;
  const latest = last?.seq ?? 0;
  const lastFromOthers = Boolean(last && last.sender_id !== me);
  const hadUnread = chat.unread_count > 0 || chat.unread_mentions > 0;
  useEffect(() => {
    if (state.status !== "ready" || !atBottom || !visible) return;
    if (latest <= marked.current && !hadUnread) return;
    marked.current = latest;
    supabase.rpc("mark_conversation_read", { target: chat.id }).then(({ error }) => {
      if (error) return;
      // Update the chat list's badges, the bell and the Group tab's number.
      if (hadUnread) onRead();
      if (hadUnread || lastFromOthers) refreshAlerts();
    });
  }, [supabase, chat.id, hadUnread, lastFromOthers, state.status, atBottom, visible, latest, onRead, refreshAlerts]);
  const isGroup = chat.kind === "group";
  const other = otherMember(chat, me);
  const title = titleOf(chat, me);
  const subtitle = isGroup ? memberLabel(chat.members.length) : other ? `@${other.username}` : "This person deleted their account";

  return (
    <section aria-label={title} className={`min-h-0 flex-col rounded-3xl border border-line bg-white ${className}`}>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chats"
          className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-ink md:hidden"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
        <Avatar
          src={isGroup ? chat.picture_url : other?.avatar_url}
          name={title}
          seed={isGroup ? chat.id : (other?.user_id ?? chat.id)}
          size={52}
          shape={isGroup ? "square" : "circle"}
          gradient={isGroup ? chat.avatar_gradient : null}
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-extrabold">{title}</h2>
          <p className="truncate text-[13px] text-muted">{subtitle}</p>
        </div>
        {isGroup && (
          <button
            type="button"
            onClick={onDetails}
            // On wide screens Details lives in the side panel instead.
            className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-bold hover:bg-mist sm:px-4 min-[1440px]:hidden"
          >
            <InfoIcon className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Details</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Conversation sections" className="mx-4 mt-3 flex shrink-0 gap-1 border-b border-line sm:mx-5">
        {(
          [
            ["chat", "Chat"],
            ["requests", "Requests"],
            ["files", "Files"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px flex h-11 items-center border-b-[3px] px-3.5 text-[15px] ${
              tab === key ? "border-brand font-extrabold text-ink" : "border-transparent font-semibold text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "chat" && (
        <>
          <MessageList
            supabase={supabase}
            chat={chat}
            me={me}
            state={state}
            outgoing={outgoing}
            stickToBottom={stick}
            onAtBottom={setAtBottom}
            onRetry={deliver}
            onRemove={remove}
          />
          <Composer
            supabase={supabase}
            conversationId={chat.id}
            placeholder={`Message ${title}…`}
            people={isGroup ? chat.members.filter((m) => m.user_id !== me) : other ? [other] : []}
            onSend={send}
          />
        </>
      )}

      {tab === "requests" && <Empty title="No requests yet" text="Payment and document requests made in this chat will be listed here." />}
      {tab === "files" && <Empty title="No files yet" text="Receipts and photos shared in this chat will be collected here." />}
    </section>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="m-auto max-w-xs px-6 text-center">
      <p className="font-extrabold">{title}</p>
      <p className="mt-1.5 text-sm text-muted">{text}</p>
    </div>
  );
}
