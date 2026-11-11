"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowInIcon, ArrowOutIcon, CheckIcon, FileIcon } from "@/components/app/icons";
import { useNotifications } from "@/components/app/NotificationsContext";
import { useProfile } from "@/components/app/ProfileContext";
import type { PaymentSearchRow } from "@/lib/alerts";
import { createClient } from "@/lib/supabase/client";
import { dollars, todayIso } from "../group/requests";

// The four summary cards, from the same live data as the bell and Alerts & Reminders (plain code
// adds everything up; amounts are whole cents):
//   • You owe: your unpaid shares (Pending, Confirmed, Awaiting approval or Disputed).
//   • You're owed: what others still owe on your requests (waived shares don't count).
//   • Documents to review: uploads waiting for your review on your document requests.
//   • Settled across groups: how many shares are Paid in your groups' requests, open or done.

const OPEN = new Set(["pending", "confirmed", "marked_paid", "disputed"]);

export default function SummaryCards() {
  const { id: me } = useProfile();
  const n = useNotifications();
  const supabase = useMemo(() => createClient(), []);
  const [history, setHistory] = useState<PaymentSearchRow[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  // Every request you're part of (fully paid ones too), for the settled progress. Reloads
  // whenever a payment changes anywhere (the shared alerts source reloads first).
  const lastKey = useRef("");
  useEffect(() => {
    const key = JSON.stringify((n.paymentRows ?? []).map((r) => [r.id, r.settled_count, r.share_count, r.status]));
    if (key === lastKey.current && history) return;
    lastKey.current = key;
    let live = true;
    supabase.rpc("my_payment_search").then(({ data, error }) => {
      if (!live) return;
      setHistoryFailed(Boolean(error));
      if (!error) setHistory((data ?? []) as PaymentSearchRow[]);
    });
    return () => {
      live = false;
    };
  }, [supabase, n.paymentRows, history]);

  const rows = n.paymentRows;
  const loading = rows === null;

  // You owe: your own unpaid shares on requests others sent you.
  const owing = (rows ?? []).filter((r) => r.direction === "received" && r.my_share_cents !== null && OPEN.has(r.my_share_status ?? ""));
  const owe = owing.reduce((a, r) => a + (r.my_share_cents ?? 0), 0);
  const today = todayIso();
  const overdue = owing.filter((r) => r.due_date && r.due_date < today).length;
  const awaiting = owing.filter((r) => r.my_share_status === "marked_paid").length;

  // You're owed: everyone else's unpaid shares on your requests.
  const sent = (rows ?? []).filter((r) => r.direction === "sent");
  const unpaid = sent.flatMap((r) => (r.shares ?? []).filter((s) => s.user_id !== me && OPEN.has(s.status ?? "")));
  const owed = unpaid.reduce((a, s) => a + s.amount_cents, 0);
  const people = new Set(unpaid.map((s) => s.user_id)).size;
  const toApprove = unpaid.filter((s) => s.status === "marked_paid").length;

  // Documents waiting for your review.
  const docs = n.documentRows.filter((d) => d.direction === "sent" && d.waiting_count > 0);
  const toReview = docs.reduce((a, d) => a + d.waiting_count, 0);

  // Settled across groups: Paid shares out of all shares (waived ones left out) in group requests.
  const groupRows = (history ?? []).filter((r) => r.conversation_kind === "group");
  const shares = groupRows.flatMap((r) => (r.shares ?? []).filter((s) => s.status !== "waived"));
  const paid = shares.filter((s) => s.status === "settled");
  const percent = shares.length ? Math.round((paid.length / shares.length) * 100) : 0;
  const groupsWithRequests = new Set(groupRows.map((r) => r.conversation_id)).size;

  const docHref = docs.length === 1 ? `/group/${docs[0].conversation_id}/documents/${docs[0].id}` : "/notifications";

  return (
    <section aria-label="Summary" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Card
        label="You owe"
        icon={<ArrowOutIcon className="h-[18px] w-[18px]" />}
        chip="bg-butter-strong text-[#7A5E05]"
        value={loading ? null : dollars(owe)}
        valueClass="text-ink"
        note={
          loading
            ? null
            : owing.length === 0
              ? "You don't owe anything"
              : `${owing.length} ${owing.length === 1 ? "request" : "requests"}${overdue ? ` · ${overdue} overdue` : ""}${awaiting ? ` · ${awaiting} awaiting approval` : ""}`
        }
        href={owing.length ? "/notifications" : undefined}
      />
      <Card
        label="You're owed"
        icon={<ArrowInIcon className="h-[18px] w-[18px]" />}
        chip="bg-tint text-brand"
        value={loading ? null : dollars(owed)}
        valueClass="text-brand"
        note={
          loading
            ? null
            : owed === 0
              ? "Nobody owes you anything"
              : `From ${people} ${people === 1 ? "person" : "people"}${toApprove ? ` · ${toApprove} to approve` : ""}`
        }
        href={owed ? "/notifications" : undefined}
      />
      <Card
        label="Documents to review"
        icon={<FileIcon className="h-[18px] w-[18px]" />}
        chip="bg-butter text-honey"
        value={loading ? null : toReview === 0 ? "None" : `${toReview} ${toReview === 1 ? "document" : "documents"}`}
        valueClass={toReview ? "text-honey" : "text-ink"}
        note={loading ? null : toReview === 0 ? "You're all set" : `Waiting for your review in ${docs.length} ${docs.length === 1 ? "request" : "requests"}`}
        href={toReview ? docHref : undefined}
      />
      <Card
        label="Settled across groups"
        icon={<CheckIcon className="h-[18px] w-[18px]" />}
        chip="bg-citron text-[#55701A]"
        value={history === null ? (historyFailed ? "—" : null) : shares.length ? `${percent}%` : "—"}
        valueClass="text-[#4A6418]"
        note={
          history === null
            ? historyFailed
              ? "Couldn't load"
              : null
            : shares.length
              ? `${paid.length} of ${shares.length} shares paid${groupsWithRequests > 1 ? ` in ${groupsWithRequests} groups` : ""}`
              : "No payments in your groups yet"
        }
        bar={shares.length ? percent : null}
      />
    </section>
  );
}

function Card({
  label,
  icon,
  chip,
  value,
  valueClass,
  note,
  bar,
  href,
}: {
  label: string;
  icon: React.ReactNode;
  chip: string;
  /** null while loading */
  value: string | null;
  valueClass: string;
  note: string | null;
  bar?: number | null;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${chip}`}>{icon}</span>
        <p className="text-xs font-bold tracking-[0.08em] text-muted uppercase">{label}</p>
      </div>
      {value === null ? (
        <span aria-hidden="true" className="mt-4 block h-7 w-24 animate-pulse rounded bg-mist" />
      ) : (
        <p className={`mt-3 text-[28px] font-extrabold tracking-tight ${valueClass}`}>{value}</p>
      )}
      {typeof bar === "number" && (
        <div className="mt-2.5 h-2 overflow-hidden rounded bg-[#EEF2E2]" role="progressbar" aria-valuenow={bar} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded bg-leaf" style={{ width: `${bar}%` }} />
        </div>
      )}
      {note === null ? (
        <span aria-hidden="true" className="mt-2 block h-3 w-32 animate-pulse rounded bg-mist" />
      ) : (
        <p className="mt-1.5 text-[13px] text-muted">{note}</p>
      )}
    </>
  );
  const cls = "block rounded-[20px] border border-[#E3E8DC] bg-white p-5";
  return href ? (
    <Link href={href} className={`${cls} hover:border-brand/40 hover:bg-mist/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
