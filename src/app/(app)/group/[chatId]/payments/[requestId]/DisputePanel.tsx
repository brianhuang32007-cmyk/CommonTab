"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { createClient } from "@/lib/supabase/client";
import { disputeRoomHref, dollars, stamp, type PaymentDispute } from "../../../requests";

// Disputes on a request's Details page: just the list. Each dispute has its own page
// (chat on the left, negotiation on the right) that "Open Dispute Chat" goes to.
// Only the requester and the person disputing get anything back from the database.

/** The disputes you're part of on this request, kept live. null while loading. */
export function useMyDisputes(requestId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [disputes, setDisputes] = useState<PaymentDispute[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_payment_disputes", { req: requestId });
    if (!error) setDisputes((data ?? []) as PaymentDispute[]);
  }, [supabase, requestId]);

  // The database only sends rows this person may see.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    const channel = supabase
      .channel(`disputes-${requestId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_disputes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispute_messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "dispute_proposals" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, requestId, load]);

  return { disputes, reload: load };
}

/** The dispute to open for this member: their open one, else their latest. */
export function disputeFor(disputes: PaymentDispute[] | null, member: string) {
  const mine = (disputes ?? []).filter((d) => d.member.user_id === member);
  return mine.find((d) => d.status === "open") ?? mine[0] ?? null;
}

export function DisputeStatusChip({ dispute }: { dispute: Pick<PaymentDispute, "status"> }) {
  return dispute.status === "open" ? (
    <span className="shrink-0 rounded-full bg-butter px-2.5 py-0.5 text-xs font-bold text-honey">Open</span>
  ) : (
    <span className="shrink-0 rounded-full bg-tint px-2.5 py-0.5 text-xs font-bold text-brand">Resolved</span>
  );
}

export default function DisputePanel({
  chatId,
  requestId,
  disputes,
  iAmRequester,
}: {
  chatId: string;
  requestId: string;
  disputes: PaymentDispute[] | null;
  iAmRequester: boolean;
}) {
  if (!disputes?.length) return null;
  const openCount = disputes.filter((d) => d.status === "open").length;

  return (
    <section id="dispute" className="rounded-3xl border border-line bg-white p-6 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-extrabold">{iAmRequester ? "Disputes" : "Your dispute"}</h3>
        <p className="text-sm text-muted">{openCount ? `${openCount} open` : "None open"}</p>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {iAmRequester
          ? "Open a dispute to chat privately and negotiate the share."
          : "Open the dispute to chat with the requester and propose a new amount."}
      </p>

      <ul className="mt-3 flex flex-col gap-2" aria-label="Disputes">
        {disputes.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
            {iAmRequester && (
              <Avatar src={d.member.avatar_url} name={`${d.member.first_name} ${d.member.last_name}`} seed={d.member.user_id} size={36} />
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-bold">
                {iAmRequester ? `${d.member.first_name} ${d.member.last_name}` : `Opened ${stamp(d.created_at)}`}
              </span>
              <span className="text-[13px] text-muted">
                {d.status === "open"
                  ? `Disputing ${dollars(d.original_cents)}`
                  : d.resolution === "waived"
                    ? "Payment canceled"
                    : d.resolution === "withdrawn"
                      ? `Dispute canceled · share stays ${dollars(d.final_cents ?? 0)}`
                      : `Changed to ${dollars(d.final_cents ?? 0)}`}
              </span>
            </span>
            <DisputeStatusChip dispute={d} />
            <Link
              href={disputeRoomHref(chatId, requestId, d.id)}
              className="flex h-11 shrink-0 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
            >
              Open Dispute Chat
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
