// Demo only: a group chat with an @tagged payment request and each person's status.
type Status = "Settled" | "Marked paid" | "Confirmed" | "Pending" | "Disputed";

const statusStyle: Record<Status, string> = {
  Settled: "bg-brand text-white",
  "Marked paid": "bg-mint text-ink",
  Confirmed: "bg-mist text-brand ring-1 ring-brand/30",
  Pending: "bg-mist text-muted ring-1 ring-line",
  Disputed: "bg-butter text-honey ring-1 ring-honey/20",
};

const shares: { name: string; status: Status }[] = [
  { name: "maya", status: "Settled" },
  { name: "jordan", status: "Marked paid" },
  { name: "alex", status: "Confirmed" },
  { name: "priya", status: "Confirmed" },
  { name: "sam", status: "Pending" },
  { name: "lee", status: "Disputed" },
];

export default function DemoChat() {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-line sm:p-7">
      <div className="flex items-center gap-3 border-b border-line pb-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
          SC
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-ink">Ski Club · Tahoe Trip</p>
          <p className="text-sm text-muted">6 members</p>
        </div>
        <span className="rounded-full bg-mint/60 px-3 py-1 text-xs font-semibold text-brand">Group chat</span>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-mist px-4 py-3">
          <p className="text-xs font-semibold text-brand">Maya · organizer</p>
          <p className="mt-1 text-ink">Cabin&apos;s booked for March! Sending the split now.</p>
        </div>

        <div className="rounded-2xl border border-brand/25 bg-mist/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand">Payment request</p>
              <p className="mt-1 font-bold text-ink">Lake cabin · 2 nights</p>
              <p className="text-sm text-muted">$510.00 total · split equally · due Fri, Mar 6</p>
            </div>
            <p className="flex items-baseline gap-1 sm:flex-col sm:items-end sm:gap-0">
              <span className="text-xl font-extrabold text-ink">$85.00</span>
              <span className="text-xs text-muted">each</span>
            </p>
          </div>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Status of each share">
            {shares.map((s) => (
              <li key={s.name} className="flex items-center gap-1.5 rounded-full bg-white py-1 pl-3 pr-1 text-sm ring-1 ring-line">
                <span className="font-semibold text-ink">@{s.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle[s.status]}`}>{s.status}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-sm">
            <span className="text-muted">Pay Maya with</span>
            {["Venmo", "PayPal", "Zelle"].map((p) => (
              <span key={p} className="rounded-lg bg-white px-3 py-1.5 font-semibold text-ink ring-1 ring-line">
                {p}
              </span>
            ))}
          </div>
        </div>

        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-brand px-4 py-3 text-white">
          <p>Paid on Venmo, proof attached. Thanks Maya!</p>
        </div>
      </div>
    </div>
  );
}
