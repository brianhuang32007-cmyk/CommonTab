"use client";

import { useState, useTransition } from "react";
import { FormMessage, HandleField, primaryButton } from "@/components/forms";
import { PaymentLogo, type PaymentProvider } from "@/components/app/PaymentLogos";
import { normalizePaypal, normalizeVenmo, normalizeZelle } from "@/lib/profile";
import { saveHandles, type SaveResult } from "./actions";

const LABELS: Record<PaymentProvider, string> = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };

export default function HandlesForm({
  initial,
}: {
  initial: { venmo: string; paypal: string; zelle: string; preferred: PaymentProvider | null };
}) {
  const [values, setValues] = useState({ venmo: initial.venmo, paypal: initial.paypal, zelle: initial.zelle });
  const [preferred, setPreferred] = useState<PaymentProvider | null>(initial.preferred);
  const [result, setResult] = useState<SaveResult>({});
  const [pending, startTransition] = useTransition();

  const filled: Record<PaymentProvider, boolean> = {
    venmo: Boolean(normalizeVenmo(values.venmo)),
    paypal: Boolean(normalizePaypal(values.paypal)),
    zelle: Boolean(normalizeZelle(values.zelle)),
  };
  const options = (Object.keys(LABELS) as PaymentProvider[]).filter((p) => filled[p]);
  // If the chosen one was cleared, fall back to the first handle that's filled in.
  const shownFirst = preferred && filled[preferred] ? preferred : (options[0] ?? null);

  function set(provider: PaymentProvider, value: string) {
    setValues((v) => ({ ...v, [provider]: value }));
    setResult((r) => ({ fieldErrors: { ...r.fieldErrors, [provider]: undefined } }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveHandles({ ...values, preferred: shownFirst });
      setResult(res.ok ? { ok: true } : res);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <HandleField
        id="venmo"
        label="Venmo"
        prefix="@"
        placeholder="your-venmo"
        value={values.venmo}
        onChange={(v) => set("venmo", v)}
        error={result.fieldErrors?.venmo}
        logo={<PaymentLogo provider="venmo" className="h-6 w-6" />}
      />
      <HandleField
        id="paypal"
        label="PayPal"
        prefix="paypal.me/"
        placeholder="yourname"
        value={values.paypal}
        onChange={(v) => set("paypal", v)}
        error={result.fieldErrors?.paypal}
        logo={<PaymentLogo provider="paypal" className="h-6 w-6" />}
      />
      <HandleField
        id="zelle"
        label="Zelle"
        placeholder="Email or US phone number"
        value={values.zelle}
        onChange={(v) => set("zelle", v)}
        error={result.fieldErrors?.zelle}
        logo={<PaymentLogo provider="zelle" className="h-6 w-6" />}
      />

      <fieldset className="rounded-2xl bg-mist p-4">
        <legend className="float-left w-full text-sm font-semibold text-ink">Show first</legend>
        <p className="text-[13px] text-muted">The handle friends see first when they pay you.</p>
        {options.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((p) => (
              <label
                key={p}
                className={`flex h-11 cursor-pointer items-center gap-2 rounded-full border px-3 pr-4 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
                  shownFirst === p ? "border-brand bg-tint text-ink" : "border-line bg-white text-ink hover:bg-mist"
                }`}
              >
                <input
                  type="radio"
                  name="preferred"
                  value={p}
                  checked={shownFirst === p}
                  onChange={() => {
                    setPreferred(p);
                    setResult({});
                  }}
                  className="sr-only"
                />
                <PaymentLogo provider={p} className="h-6 w-6" />
                {LABELS[p]}
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted">Add a handle above to choose.</p>
        )}
      </fieldset>

      <FormMessage error={result.error} success={result.ok ? "Payment handles saved." : undefined} />

      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Saving…" : "Save Handles"}
        </button>
      </div>
    </form>
  );
}
