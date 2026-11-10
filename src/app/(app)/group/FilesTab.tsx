"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckIcon, FileIcon } from "@/components/app/icons";
import type { createClient } from "@/lib/supabase/client";
import { AiResult } from "./[chatId]/documents/[requestId]/parts";
import { docTypeLabel, documentHref, fileHref, fileKindLabel, type AiCheckResult, type DocFile, type DocType } from "./documents";
import { fileSize } from "./messages";

// A chat's Files tab: every accepted document from this group or DM, kept for later. Each
// one has its original files (opened in CommonTab's viewer), the AI check (summary, key
// details and transcript) if it was run, and who sent it to whom. Only the requester and the
// person who sent a document see it here. Documents from other chats live in their own chat.

type ChatDocument = {
  upload_id: string;
  request_id: string;
  conversation_id: string;
  title: string;
  doc_type: DocType;
  doc_type_other: string | null;
  requester: { user_id: string | null; first_name: string | null; last_name: string | null };
  sender: { user_id: string | null; first_name: string | null; last_name: string | null };
  note: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  ai_status: "verified" | "failed" | null;
  ai_result: AiCheckResult | null;
  files: DocFile[];
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; docs: ChatDocument[] };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function FilesTab({ supabase, chatId, me }: { supabase: ReturnType<typeof createClient>; chatId: string; me: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_chat_documents", { target: chatId });
    if (error) setState((s) => (s.status === "ready" ? s : { status: "error" }));
    else setState({ status: "ready", docs: (data ?? []) as ChatDocument[] });
  }, [supabase, chatId]);

  // A document is accepted while you're here: it appears right away.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`files-${chatId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_recipients" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, chatId, load]);

  if (state.status === "loading") {
    return (
      <p role="status" className="m-auto text-sm text-muted">
        Loading files…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="m-auto max-w-xs rounded-2xl bg-mist p-4 text-center">
        <p className="text-sm font-bold">Couldn&apos;t load files</p>
        <button
          type="button"
          onClick={() => {
            setState({ status: "loading" });
            load();
          }}
          className="mt-3 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!state.docs.length) {
    return (
      <div className="m-auto max-w-xs px-6 text-center">
        <p className="font-extrabold">No documents yet</p>
        <p className="mt-1.5 text-sm text-muted">
          Documents you send or receive in this chat are kept here once they&apos;re accepted, with the AI check. Only you and the other person
          can see them.
        </p>
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5" aria-label="Accepted documents">
      {state.docs.map((d) => (
        <li key={d.upload_id} className="mb-3 last:mb-0">
          <DocumentRecord doc={d} me={me} />
        </li>
      ))}
    </ul>
  );
}

function DocumentRecord({ doc, me }: { doc: ChatDocument; me: string }) {
  const name = (p: ChatDocument["sender"]) =>
    p.user_id === me ? "you" : [p.first_name, p.last_name].filter(Boolean).join(" ") || "a former member";
  const sentByMe = doc.sender.user_id === me;
  const verified = doc.ai_status === "verified";

  return (
    <article className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
          <FileIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold break-words">{doc.title}</p>
          <p className="text-[13px] text-muted">
            {docTypeLabel(doc)} · {sentByMe ? `You sent it to ${name(doc.requester)}` : `From ${name(doc.sender)}`} · Accepted {day(doc.accepted_at)}
          </p>
        </div>
        {verified ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-white">
            <CheckIcon className="h-3.5 w-3.5" />
            AI Verified
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-mist px-2.5 py-0.5 text-xs font-bold text-muted">Checked by hand</span>
        )}
      </div>

      {doc.note && <p className="mt-2 rounded-xl bg-mist px-3 py-2 text-sm whitespace-pre-wrap text-ink">{doc.note}</p>}

      <p className="mt-3 text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Original {doc.files.length === 1 ? "document" : "documents"}</p>
      <ul className="mt-1.5 flex flex-col gap-2">
        {doc.files.map((f) => (
          <li key={f.id}>
            <Link
              href={fileHref(doc.conversation_id, doc.request_id, f.id)}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 hover:bg-mist"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{f.name}</span>
                <span className="block text-[13px] text-muted">
                  {fileKindLabel(f)} · {fileSize(f.size_bytes)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold text-brand">Open</span>
            </Link>
          </li>
        ))}
      </ul>

      {doc.ai_result && doc.ai_status ? (
        <details className="mt-3 rounded-xl border border-line px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-ink">
            AI summary, details and transcript
          </summary>
          <div className="pb-3">
            <AiResult check={doc.ai_result} status={doc.ai_status} />
          </div>
        </details>
      ) : (
        <p className="mt-3 text-[13px] text-muted">No AI check was run; the requester checked it by hand.</p>
      )}

      <Link
        href={documentHref(doc.conversation_id, doc.request_id)}
        className="mt-3 inline-flex min-h-11 items-center text-sm font-bold text-brand hover:underline"
      >
        View Request
      </Link>
    </article>
  );
}
