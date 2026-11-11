"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, DownloadIcon, FileIcon } from "@/components/app/icons";
import { downloadLink, signedLinks } from "@/lib/signedLinks";
import { createClient } from "@/lib/supabase/client";
import { FilePreview } from "../../documents/[requestId]/files/[fileId]/FileViewer";
import { fileKindLabel } from "../../../documents";
import { fileSize } from "../../../messages";
import { stamp } from "../../../requests";

// A file sent in a chat (a spreadsheet, PDF, photo…), opened inside CommonTab instead of
// downloading it: spreadsheets show as tables with their tabs, PDFs page by page, photos with
// zoom. Download is always there. Only members of the chat can open it (the database and
// storage both check).

type File = {
  id: string;
  path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  message_id: string;
  conversation_id: string;
};
type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; file: File; url: string; sentAt: string | null; sender: string | null };

export default function ChatFileViewer() {
  const { chatId, fileId } = useParams<{ chatId: string; fileId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase
        .from("message_attachments")
        .select("id, path, name, mime_type, size_bytes, message_id, conversation_id")
        .eq("id", fileId)
        .eq("conversation_id", chatId)
        .maybeSingle();
      if (!live) return;
      if (error) return setState({ status: "error" });
      if (!data) return setState({ status: "missing" });
      const file = data as File;
      const [links, message] = await Promise.all([
        signedLinks(supabase, "chat-files", [file.path]),
        supabase.rpc("get_message", { msg_id: file.message_id }),
      ]);
      if (!live) return;
      const url = links.get(file.path);
      const sentAt = (message.data as { created_at?: string } | null)?.created_at ?? null;
      const senderId = (message.data as { sender_id?: string | null } | null)?.sender_id ?? null;
      let sender: string | null = null;
      if (senderId) {
        const { data: p } = await supabase.from("profiles").select("first_name, last_name").eq("id", senderId).maybeSingle();
        sender = p ? `${p.first_name} ${p.last_name}` : null;
      }
      if (!live) return;
      setState(url ? { status: "ready", file, url, sentAt, sender } : { status: "missing" });
    })();
    return () => {
      live = false;
    };
  }, [supabase, chatId, fileId]);

  // The chat is deleted while this is open: close the file right away (storage already refuses it).
  useEffect(() => {
    const channel = supabase
      .channel(`file-chat-${chatId}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "conversations" }, (payload) => {
        if ((payload.old as { id?: string }).id === chatId) setState({ status: "missing" });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, chatId]);

  const back = `/group?chat=${chatId}`;

  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Opening the file…
      </p>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">{state.status === "error" ? "Couldn't open this file" : "This file isn't available"}</p>
        <p className="mt-1.5 text-sm text-muted">
          {state.status === "error" ? "Check your connection and try again." : "It may have been removed, or you're not in this chat."}
        </p>
        <Link href={back} className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
          Back to the chat
        </Link>
      </div>
    );
  }

  const { file, url, sentAt, sender } = state;
  async function download() {
    setDownloading(true);
    const link = await downloadLink(supabase, "chat-files", file.path, file.name);
    setDownloading(false);
    if (link) window.location.assign(link);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 self-start text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to the chat
      </Link>
      <header className="mt-2 flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-white p-4 sm:p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
          <FileIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold">{file.name}</h2>
          <p className="truncate text-[13px] text-muted">
            {fileKindLabel(file)} · {fileSize(file.size_bytes)}
            {sender ? ` · Sent by ${sender}` : ""}
            {sentAt ? ` · ${stamp(sentAt)}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          <DownloadIcon className="h-4 w-4" />
          {downloading ? "Preparing…" : "Download"}
        </button>
      </header>
      <div className="mt-3">
        <FilePreview file={file} url={url} onDownload={download} />
      </div>
    </div>
  );
}
