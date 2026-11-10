"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

// Messages for one conversation: shapes, loading (newest first, older pages on request),
// live updates, and file uploads. Shapes match supabase/migrations/20261110080000_messages.sql.

type Client = ReturnType<typeof createClient>;

export type Attachment = {
  id: string;
  path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  position: number;
};

/** A saved message. */
export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  /** Order of arrival; breaks ties when two messages share a time. */
  seq: number;
  created_at: string;
  attachments: Attachment[];
  /** Ids of the people mentioned. */
  mentions: string[];
};

/** A file picked in the composer. It's uploaded right away so the person can see progress. */
export type DraftFile = {
  key: string;
  file: File;
  /** Local preview for images. */
  preview: string | null;
  path: string;
  status: "uploading" | "done" | "error";
  progress: number;
  error?: string;
};

/** A message you sent that isn't saved yet: on its way, or failed. */
export type Outgoing = {
  id: string;
  body: string;
  mentions: string[];
  files: DraftFile[];
  created_at: string;
  status: "sending" | "failed";
  error?: string;
};

export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
export const FILE_MAX = 10 * 1024 * 1024;
export const FILES_PER_MESSAGE = 5;
export const MESSAGE_MAX = 4000;
const PAGE = 30;

/** Blank lines at the start and spaces at the end go; everything in between stays as typed. */
export const cleanBody = (text: string) => text.replace(/^([ \t]*\r?\n)+/, "").replace(/\s+$/, "");

const bySeq = (a: Message, b: Message) => a.seq - b.seq;

function merge(current: Message[], incoming: Message[]) {
  const map = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return [...map.values()].sort(bySeq);
}

export type MessagesState = {
  status: "loading" | "error" | "ready";
  messages: Message[];
  /** More, older messages exist. */
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  retry: () => void;
  /** Add a message the app already has (e.g. the reply to sending). */
  add: (m: Message) => void;
};

export function useMessages(supabase: Client, conversationId: string): MessagesState {
  const [status, setStatus] = useState<MessagesState["status"]>("loading");
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldest = useRef<number | null>(null);
  const busyOlder = useRef(false);
  const loadedOnce = useRef(false);

  useEffect(() => {
    oldest.current = messages.length ? messages[0].seq : null;
  }, [messages]);

  const loadLatest = useCallback(async () => {
    const { data, error } = await supabase.rpc("conversation_messages", { target: conversationId, page_size: PAGE });
    if (error) {
      setStatus((s) => (s === "ready" ? s : "error"));
      return;
    }
    const page = (data ?? []) as Message[];
    // First load: whether there's more history. Later refreshes keep what's known.
    if (!loadedOnce.current) setHasOlder(page.length === PAGE);
    loadedOnce.current = true;
    setMessages((current) => merge(current, page));
    setStatus("ready");
  }, [supabase, conversationId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(loadLatest, 0);
    let connectedBefore = false;
    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          // The live notice has the bare row; fetch it with its files and mentions.
          const id = (payload.new as { id?: string }).id;
          if (!id) return;
          const { data } = await supabase.rpc("get_message", { msg_id: id });
          if (data) setMessages((current) => merge(current, [data as Message]));
        },
      )
      .subscribe((state) => {
        if (state !== "SUBSCRIBED") return;
        // Reconnected after a drop: catch up on anything missed.
        if (connectedBefore) {
          clearTimeout(timer);
          timer = setTimeout(loadLatest, 0);
        }
        connectedBefore = true;
      });
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, conversationId, loadLatest]);

  const loadOlder = useCallback(async () => {
    if (busyOlder.current || oldest.current === null) return;
    busyOlder.current = true;
    setLoadingOlder(true);
    const { data, error } = await supabase.rpc("conversation_messages", {
      target: conversationId,
      before_seq: oldest.current,
      page_size: PAGE,
    });
    if (!error) {
      const page = (data ?? []) as Message[];
      setHasOlder(page.length === PAGE);
      setMessages((current) => merge(current, page));
    }
    setLoadingOlder(false);
    busyOlder.current = false;
  }, [supabase, conversationId]);

  const retry = useCallback(() => {
    setStatus("loading");
    loadLatest();
  }, [loadLatest]);

  const add = useCallback((m: Message) => setMessages((current) => merge(current, [m])), []);

  return { status, messages, hasOlder, loadingOlder, loadOlder, retry, add };
}

/** Uploads a chat file with progress. Uses the signed-in person's own session (never a secret key). */
export function uploadChatFile(supabase: Client, path: string, file: File, onProgress: (fraction: number) => void) {
  const xhr = new XMLHttpRequest();
  let aborted = false;
  const promise = (async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("You're signed out. Sign in again to attach files.");
    if (aborted) throw new Error("Cancelled");
    await new Promise<void>((resolve, reject) => {
      xhr.open("POST", `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/chat-files/${path}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("apikey", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
      xhr.setRequestHeader("x-upsert", "false");
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        // Already there (a retry after the reply was lost) counts as uploaded.
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else if (xhr.status === 409 || /already exists|Duplicate/i.test(xhr.responseText)) resolve();
        else reject(new Error(xhr.status === 413 ? "That file is too big (10 MB max)." : "Upload failed."));
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
      xhr.onabort = () => reject(new Error("Cancelled"));
      xhr.send(file);
    });
  })();
  return {
    promise,
    abort: () => {
      aborted = true;
      xhr.abort();
    },
  };
}

/** Deletes files that were uploaded but never sent. Best effort: storage only allows unsent files. */
export async function removeUnsentFiles(supabase: Client, paths: string[]) {
  if (paths.length) await supabase.storage.from("chat-files").remove(paths);
}

export const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
