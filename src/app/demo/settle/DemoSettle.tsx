"use client";

import { useState } from "react";
import SettlePanel from "@/app/(app)/group/[chatId]/payments/[requestId]/settle/SettlePanel";
import { dollars, SHARE_STATUS, type PaymentRequestDetails, type PaymentTransfer } from "@/app/(app)/group/requests";

// The local Settle demo: the payer's screens on the left, and what the requester sees on the
// right, updating as you go (Pending → Confirmed → Paid). Everything here is made up and
// lives only in this page; reloading starts over.

type Status = NonNullable<PaymentRequestDetails["my_share_status"]>;

const PAYEE: NonNullable<PaymentRequestDetails["payee"]> = {
  user_id: "demo-alex",
  first_name: "Alex",
  last_name: "Rivera",
  username: "alexr",
  avatar_url: null,
  venmo_username: "alex-rivera",
  paypal_username: "alexrivera",
  zelle_contact: "+15551234567",
  preferred_handle: "venmo",
};

const OTHERS: { name: string; cents: number; status: Status }[] = [
  { name: "Alex (requester)", cents: 8500, status: "settled" },
  { name: "Priya", cents: 8500, status: "settled" },
  { name: "Sam", cents: 8500, status: "confirmed" },
  { name: "Lee", cents: 8500, status: "pending" },
  { name: "Maya", cents: 8500, status: "pending" },
];
const MY_SHARE = 8500;

export default function DemoSettle() {
  const [status, setStatus] = useState<Status>("pending");
  const [paid, setPaid] = useState<PaymentTransfer | null>(null);
  const [run, setRun] = useState(0);

  const people = [...OTHERS.slice(0, 1), { name: "You (Jordan)", cents: MY_SHARE, status }, ...OTHERS.slice(1)];
  const counted = people.filter((p) => p.status !== "waived");
  const settled = counted.filter((p) => p.status === "settled").length;
  const owed = counted.filter((p) => p.status !== "settled").reduce((a, p) => a + p.cents, 0);

  return (
    <main className="min-h-screen bg-mist px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-butter-strong px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-[#5C4A0B]">
            <span className="font-bold">Local demo.</span> Made-up people, no sign-in, nothing saved, no real money. Reload or reset to
            start over.
          </p>
          <button
            type="button"
            onClick={() => {
              setStatus("pending");
              setPaid(null);
              setRun((n) => n + 1);
            }}
            className="h-11 rounded-xl border border-line bg-white px-4 text-sm font-bold hover:bg-mist"
          >
            Reset Demo
          </button>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted uppercase">What you (the payer) see</p>
            <SettlePanel
              key={run}
              title="Cabin weekend"
              shareCents={MY_SHARE}
              status={status}
              payee={PAYEE}
              paid={paid}
              payerHandles={{ venmo: "jordan-demo", paypal: null, zelle: null }}
              backHref="/demo/settle"
              chatHref="/demo/settle"
              onConfirm={async () => {
                await new Promise((r) => setTimeout(r, 400));
                setStatus("confirmed");
                return null;
              }}
              onPay={async (method) => {
                // The simulation accepts every payment. Only one per share: once paid, the
                // receipt shows and the button is gone (Reset Demo starts over).
                if (paid) return { ok: false, message: "You've already paid this share" };
                const transfer: PaymentTransfer = {
                  id: crypto.randomUUID(),
                  payer_id: "demo-you",
                  first_name: "Jordan",
                  last_name: "",
                  amount_cents: MY_SHARE,
                  method,
                  confirmation: `CT-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
                  created_at: new Date().toISOString(),
                };
                setStatus("settled");
                setPaid(transfer);
                return { ok: true, transfer };
              }}
            />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-muted uppercase">What Alex (the requester) sees</p>
            <section className="rounded-3xl border border-line bg-white p-6">
              <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Payment request</p>
              <p className="mt-1 text-xl font-extrabold">Cabin weekend</p>
              <p className="font-extrabold">{dollars(51000)} total</p>
              <p className="text-[13px] text-muted">Due Nov 13 · Requested by Alex</p>
              <p className="mt-3 flex items-baseline justify-between border-t border-line pt-3 font-bold">
                You&apos;re still owed <span className="text-xl font-extrabold text-brand">{dollars(owed)}</span>
              </p>
              <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-mist">
                <div
                  className="h-full rounded-full bg-leaf transition-all"
                  style={{ width: `${Math.round((settled / counted.length) * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {settled} of {counted.length} settled
              </p>
              <ul className="mt-3 flex flex-col gap-1.5">
                {people.map((p) => (
                  <li
                    key={p.name}
                    className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm ${p.name.startsWith("You") ? "bg-tint" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{p.name.startsWith("You") ? "Jordan" : p.name}</span>
                    <span className="text-muted">{dollars(p.cents)}</span>
                    <span className={`w-[92px] rounded-full px-2 py-0.5 text-center text-xs font-bold ${SHARE_STATUS[p.status].className}`}>
                      {SHARE_STATUS[p.status].label}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-2xl border border-line px-4 py-3 text-sm">
                <p className="font-bold">Reminders</p>
                <p className="mt-0.5 text-[13px] text-muted">Sent 1 day before the due date to anyone who hasn&apos;t paid.</p>
                <p className="mt-1.5 text-ink">
                  {people
                    .filter((p) => p.status !== "settled" && p.status !== "waived")
                    .map((p) => (p.name.startsWith("You") ? "Jordan" : p.name))
                    .join(", ") || "No one: everyone has paid."}
                </p>
                {paid && <p className="mt-1 text-[13px] font-semibold text-brand">Jordan paid, so Jordan&apos;s reminders were cleared.</p>}
              </div>
              {paid && (
                <div className="mt-3 rounded-2xl bg-tint px-4 py-3 text-sm">
                  <p className="font-bold text-brand">Payment received</p>
                  <p className="text-ink">
                    Jordan paid {dollars(paid.amount_cents)} · <span className="font-mono font-bold">{paid.confirmation}</span>
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
