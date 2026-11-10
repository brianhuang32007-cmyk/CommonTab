"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DownloadIcon, FileIcon, SendIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { DOC_STATUS, documentHref, type DocumentRequestRow } from "../group/documents";
import { titleOf, type Conversation } from "../group/types";
import { downloadBlob, sendFileToChat, submitFileToRequest } from "./drafting";

// Where a finished form or spreadsheet goes: Download it, send it to a chat, or answer a
// document request someone sent you. Nothing is sent until the person taps the button.

type Where = "download" | "chat" | "request";

export default function SendPanel({
  makeFile,
  title,
  defaultChatId,
  formats,
  onSent,
}: {
  /** Builds the file in the chosen format (e.g. "pdf", "xlsx", "csv"). */
  makeFile: (format: string) => Promise<File>;
  title: string;
  defaultChatId: string | null;
  formats: { id: string; label: string }[];
  onSent: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { id: me } = useProfile();
  const [where, setWhere] = useState<Where>("download");
  const [format, setFormat] = useState(formats[0].id);
  const [chats, setChats] = useState<Conversation[] | null>(null);
  const [requests, setRequests] = useState<DocumentRequestRow[] | null>(null);
  const [chatId, setChatId] = useState<string>(defaultChatId ?? "");
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState(`Here's ${title}.`);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; href: string } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([supabase.rpc("my_conversations"), supabase.rpc("my_document_requests")]).then(([c, r]) => {
      if (!live) return;
      setChats(((c.data ?? []) as Conversation[]).filter(Boolean));
      setRequests(
        ((r.data ?? []) as DocumentRequestRow[]).filter(
          (x) => x.direction === "received" && x.status === "open" && x.my_status !== "accepted" && x.my_status !== "cant_provide",
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [supabase]);

  async function go() {
    setBusy(true);
    setProblem(null);
    try {
      const file = await makeFile(format);
      if (where === "download") {
        downloadBlob(file, file.name);
        setDone(null);
      } else if (where === "chat") {
        if (!chatId) throw new Error("Pick a chat.");
        await sendFileToChat(supabase, chatId, file, message.trim());
        setDone({ text: "Sent to the chat.", href: `/group?chat=${chatId}` });
        onSent();
      } else {
        if (!requestId) throw new Error("Pick the document request you're answering.");
        await submitFileToRequest(supabase, me, requestId, file, message.trim() || null);
        const r = requests?.find((x) => x.id === requestId);
        setDone({ text: "Sent. It's waiting for the requester's review, and you can run AI Verify on it there.", href: r ? documentHref(r.conversation_id, r.id) : "/notifications" });
        onSent();
      }
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't send it. Try again.");
    }
    setBusy(false);
  }

  return (
    <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
      <h3 className="text-lg font-extrabold">Send it</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Where it goes">
        <Choice active={where === "download"} onClick={() => setWhere("download")} icon={<DownloadIcon className="h-5 w-5" />} label="Download" />
        <Choice active={where === "chat"} onClick={() => setWhere("chat")} icon={<SendIcon className="h-5 w-5" />} label="Send to a Chat" />
        <Choice active={where === "request"} onClick={() => setWhere("request")} icon={<FileIcon className="h-5 w-5" />} label="Answer a Request" />
      </div>

      {formats.length > 1 && (
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-sm font-bold">File type</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="h-12 rounded-xl border border-line bg-white px-3 text-base">
            {formats.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {where === "chat" && (
        <>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm font-bold">Chat</span>
            <select value={chatId} onChange={(e) => setChatId(e.target.value)} className="h-12 rounded-xl border border-line bg-white px-3 text-base">
              <option value="">{chats === null ? "Loading…" : "Pick a chat"}</option>
              {(chats ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {titleOf(c, me)}
                  {c.kind === "dm" ? " (direct message)" : ""}
                </option>
              ))}
            </select>
          </label>
          <MessageField value={message} onChange={setMessage} label="Message" />
        </>
      )}

      {where === "request" && (
        <>
          {requests !== null && requests.length === 0 ? (
            <p className="mt-4 rounded-2xl bg-mist px-4 py-3 text-sm text-muted">No open document requests are waiting for you.</p>
          ) : (
            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-sm font-bold">Document request</span>
              <select value={requestId} onChange={(e) => setRequestId(e.target.value)} className="h-12 rounded-xl border border-line bg-white px-3 text-base">
                <option value="">{requests === null ? "Loading…" : "Pick the request you're answering"}</option>
                {(requests ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · from {r.requester_first_name ?? "someone"} · {r.conversation_name ?? "Direct message"}
                    {r.my_status ? ` · ${DOC_STATUS[r.my_status].label}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <MessageField value={message} onChange={setMessage} label="Note · Optional" />
        </>
      )}

      {problem && (
        <p role="alert" className="mt-3 rounded-xl bg-butter px-3.5 py-2.5 text-sm font-semibold text-honey">
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className="mt-3 rounded-xl bg-tint px-3.5 py-2.5 text-sm font-semibold text-brand">
          {done.text}{" "}
          <Link href={done.href} className="underline">
            Open it
          </Link>
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={go}
          disabled={busy || (where === "request" && !requests?.length)}
          className="h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Working…" : where === "download" ? "Download" : where === "chat" ? "Send to Chat" : "Send as My Document"}
        </button>
      </div>
    </section>
  );
}

function Choice({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${
        active ? "border-brand bg-tint text-brand" : "border-line bg-white text-ink hover:bg-mist"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function MessageField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="mt-4 flex flex-col gap-1.5">
      <span className="text-sm font-bold">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        className="h-12 rounded-xl border border-line bg-white px-3.5 text-base outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
      />
    </label>
  );
}
