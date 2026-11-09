// Demo only: the dashboard view of owe / owed / overdue and per-request progress.
const requests = [
  { title: "Lake cabin · 2 nights", group: "Ski Club", settled: 2, total: 6, note: "Due Fri" },
  { title: "Club T-shirts", group: "Robotics Club", settled: 9, total: 12, note: "Due Sun" },
  { title: "Gas for the drive", group: "Ski Club", settled: 3, total: 4, note: "Overdue", overdue: true },
];

export default function DemoDashboard() {
  return (
    <div className="flex h-full flex-col rounded-3xl bg-white p-5 shadow-sm ring-1 ring-line sm:p-7">
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="font-bold text-ink">Your dashboard</p>
          <p className="text-sm text-muted">Every group, one view</p>
        </div>
        <span className="rounded-full bg-mint/60 px-3 py-1 text-xs font-semibold text-brand">Live</span>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-mist p-3 sm:p-4">
          <dt className="text-xs font-semibold text-muted">You owe</dt>
          <dd className="mt-1 text-lg font-extrabold text-ink sm:text-xl">$97.50</dd>
        </div>
        <div className="rounded-2xl bg-mist p-3 sm:p-4">
          <dt className="text-xs font-semibold text-muted">You&apos;re owed</dt>
          <dd className="mt-1 text-lg font-extrabold text-brand sm:text-xl">$340.00</dd>
        </div>
        <div className="rounded-2xl bg-red-50 p-3 sm:p-4">
          <dt className="text-xs font-semibold text-warn">Overdue</dt>
          <dd className="mt-1 text-lg font-extrabold text-warn sm:text-xl">1</dd>
        </div>
      </dl>

      <ul className="mt-5 flex flex-col gap-4">
        {requests.map((r) => {
          const pct = Math.round((r.settled / r.total) * 100);
          return (
            <li key={r.title} className="rounded-2xl ring-1 ring-line p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{r.title}</p>
                  <p className="text-sm text-muted">{r.group}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    r.overdue ? "bg-red-50 text-warn" : "bg-mist text-muted"
                  }`}
                >
                  {r.note}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full bg-mist"
                  role="progressbar"
                  aria-valuenow={r.settled}
                  aria-valuemin={0}
                  aria-valuemax={r.total}
                  aria-label={`${r.title}: ${r.settled} of ${r.total} settled`}
                >
                  <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                </div>
                <span className="shrink-0 text-sm font-semibold text-ink">
                  {r.settled}/{r.total} settled
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
