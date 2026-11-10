"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { DOC_STATUS, docTypeLabel, documentHref, type DocumentRequestRow } from "./documents";
import { detailsHref, dollars, dueLabel, type PaymentRequestRow } from "./requests";

// A chat's Requests tab: every open payment and document request you sent or received, most
// urgent deadline first (overdue, then due soonest, then no due date). Each row opens that
// request's page.

/** "1 of 3 settled": everyone in the split, including a requester who's in it (already settled), as on the chat card. */
function progress(r: PaymentRequestRow) {
  return `${r.settled_count} of ${r.share_count} settled`;
}

type Row = { kind: "payment"; row: PaymentRequestRow } | { kind: "document"; row: DocumentRequestRow };
type State = { status: "loading" } | { status: "error" } | { status: "ready"; rows: Row[] };

/** Overdue and soonest first; no due date last; then newest. */
const byDeadline = (a: Row, b: Row) => {
  const da = a.row.due_date;
  const db = b.row.due_date;
  if (da !== db) return !da ? 1 : !db ? -1 : da.localeCompare(db);
  return (b.row.created_at ?? "").localeCompare(a.row.created_at ?? "");
};

export default function RequestsTab({ supabase, chatId }: { supabase: ReturnType<typeof createClient>; chatId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    const [payments, documents] = await Promise.all([
      supabase.rpc("my_payment_requests", { target: chatId }),
      supabase.rpc("my_document_requests", { target: chatId }),
    ]);
    if (payments.error) return setState((s) => (s.status === "ready" ? s : { status: "error" }));
    const rows: Row[] = [
      ...((payments.data ?? []) as PaymentRequestRow[]).map((row): Row => ({ kind: "payment", row })),
      ...(documents.error ? [] : ((documents.data ?? []) as DocumentRequestRow[])).map((row): Row => ({ kind: "document", row })),
    ].sort(byDeadline);
    setState({ status: "ready", rows });
  }, [supabase, chatId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    // New requests and share changes (only rows you're allowed to see arrive).
    const channel = supabase
      .channel(`requests-${chatId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_shares" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "document_requests" }, refresh)
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
        Loading requests…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="m-auto max-w-xs rounded-2xl bg-mist p-4 text-center">
        <p className="text-sm font-bold">Couldn&apos;t load requests</p>
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
  if (!state.rows.length) {
    return (
      <div className="m-auto max-w-xs px-6 text-center">
        <p className="font-extrabold">No open requests</p>
        <p className="mt-1.5 text-sm text-muted">Payment and document requests you send or receive in this chat will be listed here.</p>
      </div>
    );
  }

  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
      {state.rows.map((item) => {
        if (item.kind === "document") return <DocumentRow key={item.row.id} r={item.row} />;
        const r = item.row;
        const due = dueLabel(r.due_date);
        const sent = r.direction === "sent";
        return (
          <li key={r.id} className="border-b border-[#EEF1EA] last:border-b-0">
            <Link href={detailsHref(r.conversation_id, r.id)} className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${sent ? "bg-tint text-brand" : "bg-butter-strong text-[#5C4A0B]"}`}
                  >
                    {sent ? "Sent" : "Received"}
                  </span>
                  <span className="truncate font-bold">{r.title}</span>
                </span>
                <span className="text-[13px] text-muted">Payment · {progress(r)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className={`font-extrabold ${sent ? "text-brand" : "text-ink"}`}>
                  {dollars(sent ? r.outstanding_cents : (r.my_share_cents ?? 0))}
                </span>
                <span
                  className={due.overdue ? "rounded-full bg-butter px-2 py-0.5 text-[11px] font-bold text-honey" : "text-[11px] text-muted"}
                >
                  {due.text}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DocumentRow({ r }: { r: DocumentRequestRow }) {
  const due = dueLabel(r.due_date);
  const sent = r.direction === "sent";
  const status = sent
    ? r.waiting_count
      ? { label: `${r.waiting_count} to review`, className: DOC_STATUS.submitted.className }
      : { label: `${r.accepted_count} of ${r.recipient_count} accepted`, className: "bg-mist text-muted" }
    : r.my_status
      ? DOC_STATUS[r.my_status]
      : null;
  return (
    <li className="border-b border-[#EEF1EA] last:border-b-0">
      <Link href={documentHref(r.conversation_id, r.id)} className="flex items-center gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${sent ? "bg-tint text-brand" : "bg-butter-strong text-[#5C4A0B]"}`}
            >
              {sent ? "Sent" : "Received"}
            </span>
            <span className="truncate font-bold">{r.title}</span>
          </span>
          <span className="text-[13px] text-muted">Document · {docTypeLabel(r)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {status && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.className}`}>{status.label}</span>}
          <span className={due.overdue ? "rounded-full bg-butter px-2 py-0.5 text-[11px] font-bold text-honey" : "text-[11px] text-muted"}>
            {due.text}
          </span>
        </span>
      </Link>
    </li>
  );
}
