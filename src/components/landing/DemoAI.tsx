import { CheckIcon, ReceiptIcon, SparkIcon } from "./icons";

// Demo only: CommonTab AI and the AI receipt check.
export function CommonTabAICard() {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-brand p-6 text-white sm:p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15">
        <SparkIcon className="h-5 w-5" />
      </div>
      <h3 className="mt-5 text-2xl font-bold tracking-tight">CommonTab AI</h3>
      <p className="mt-3 leading-relaxed text-white/90">
        Ask about your groups in plain language. It answers, reminds you before deadlines and drafts
        requests for you.
      </p>

      <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-night/35 p-4">
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-white px-4 py-2.5 text-sm text-ink">
          What do I owe this week?
        </p>
        <p className="max-w-[90%] rounded-2xl rounded-tl-md bg-white/10 px-4 py-2.5 text-sm leading-relaxed">
          <strong>$97.50</strong>: $85.00 for the cabin (Fri) and $12.50 for T-shirts (Sun).
        </p>
        <div className="flex flex-wrap gap-2">
          {["Did everyone pay for the cabin?", "Remind me Thursday"].map((q) => (
            <span key={q} className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
              {q}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-5 text-sm text-white/85">
        Nothing is sent, approved or paid without your tap.
      </p>
    </div>
  );
}

const items = [
  { label: "Groceries", amount: "$96.40" },
  { label: "Firewood", amount: "$18.00" },
  { label: "Ice", amount: "$6.60" },
];

export function ReceiptCheckCard() {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white p-6 shadow-sm ring-1 ring-line sm:p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-mint/60 text-brand">
        <ReceiptIcon className="h-5 w-5" />
      </div>
      <h3 className="mt-5 text-2xl font-bold tracking-tight text-ink">AI receipt check</h3>
      <p className="mt-3 leading-relaxed text-muted">
        Upload a receipt. AI reads the items and total, checks it and suggests a split. You decide.
      </p>

      <div className="mt-6 rounded-2xl bg-mist p-4 ring-1 ring-line">
        <div className="flex items-baseline justify-between">
          <p className="font-semibold text-ink">Grocery store</p>
          <p className="text-sm text-muted">Mar 4</p>
        </div>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {items.map((i) => (
            <li key={i.label} className="flex justify-between text-ink">
              <span>{i.label}</span>
              <span>{i.amount}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-3 font-bold text-ink">
          <span>Total</span>
          <span>$121.00</span>
        </div>
        <div className="mt-4 flex flex-col gap-2 text-sm">
          <p className="flex items-center gap-2 text-brand">
            <CheckIcon className="h-4 w-4 shrink-0" />
            <span className="font-semibold">Matches the request: grocery receipt</span>
          </p>
          <p className="flex items-center gap-2 text-ink">
            <CheckIcon className="h-4 w-4 shrink-0 text-brand" />
            Suggested split: 4 people · $30.25 each
          </p>
        </div>
      </div>
    </div>
  );
}
