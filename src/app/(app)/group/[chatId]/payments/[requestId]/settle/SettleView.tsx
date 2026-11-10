"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeftIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { detailsHref, type PayMethod, type PaymentRequestDetails, type PaymentTransfer } from "../../../../requests";
import SettlePanel from "./SettlePanel";

// /…/settle: pay your share (demo, no real money). Confirm first if it's still Pending.
// The database checks everything again; the payment id is made once per visit, so a
// double tap or a retry can't pay twice.

export default function SettleView() {
  const { chatId, requestId } = useParams<{ chatId: string; requestId: string }>();
  const { id: me, venmo, paypal, zelle } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [request, setRequest] = useState<PaymentRequestDetails | null | "error" | "loading">("loading");
  const payId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("payment_request_details", { req: requestId });
    setRequest(error ? "error" : ((data as PaymentRequestDetails | null) ?? null));
  }, [supabase, requestId]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const back = detailsHref(chatId, requestId);
  const chat = `/group?chat=${chatId}`;
  const shell = (body: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[560px] pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to the request
      </Link>
      <div className="mt-2">{body}</div>
    </div>
  );

  if (request === "loading") {
    return shell(
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading…
      </p>,
    );
  }
  if (request === "error" || request === null || request.my_share_cents === null || !request.my_share_status || request.payee_id === me) {
    return shell(
      <section className="rounded-3xl border border-line bg-white p-6 text-sm text-muted">
        {request === "error"
          ? "Couldn't load this request. Check your connection and try again."
          : request === null
            ? "This request isn't available."
            : "You're not paying in this request, so there's nothing to settle."}
      </section>,
    );
  }

  const paid = (request.transfers ?? []).find((t) => t.payer_id === me) ?? null;

  return shell(
    <SettlePanel
      title={request.title}
      shareCents={request.my_share_cents}
      status={request.my_share_status}
      payee={request.payee}
      payerHandles={{ venmo, paypal, zelle }}
      handlesHref="/preferences#payment-handles"
      paid={paid}
      backHref={back}
      chatHref={chat}
      onConfirm={async () => {
        const { error } = await supabase.rpc("confirm_payment_share", { req: requestId });
        if (error) return error.message;
        await load();
        return null;
      }}
      onPay={async (method: PayMethod) => {
        payId.current ??= crypto.randomUUID();
        const { data, error } = await supabase.rpc("pay_my_share", { transfer_id: payId.current, req: requestId, pay_method: method });
        if (error) return { ok: false, message: error.message };
        return { ok: true, transfer: { ...(data as PaymentTransfer), first_name: "", last_name: "", payer_id: me } };
      }}
    />,
  );
}
