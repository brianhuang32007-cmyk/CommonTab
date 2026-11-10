import { ArrowInIcon, ArrowOutIcon, CheckIcon, ClockIcon } from "@/components/app/icons";
import { NeedsAttention, RecentActivity } from "./ActivityCards";
import { DashboardData } from "./DashboardData";
import GroupsCard from "./GroupsCard";
import Greeting from "./Greeting";

export const metadata = { title: "Dashboard · CommonTab" };

// Payment requests arrive in Step 9, so every total is zero for now.
const stats = [
  {
    label: "You owe",
    value: "$0.00",
    note: "No open requests",
    icon: ArrowOutIcon,
    chip: "bg-butter-strong text-[#7A5E05]",
    valueClass: "text-ink",
  },
  {
    label: "You're owed",
    value: "$0.00",
    note: "Nobody owes you yet",
    icon: ArrowInIcon,
    chip: "bg-tint text-brand",
    valueClass: "text-brand",
  },
  { label: "Overdue", value: "0 items", note: "Nothing overdue", icon: ClockIcon, chip: "bg-butter text-honey", valueClass: "text-honey" },
  {
    label: "Settled across groups",
    value: "—",
    note: "No requests yet",
    icon: CheckIcon,
    chip: "bg-citron text-[#55701A]",
    valueClass: "text-[#4A6418]",
    bar: 0,
  },
];

export default function DashboardPage() {
  return (
    // Groups, unread counts and mentions are live and match the Group page. The money totals
    // stay at zero until payment requests arrive (Step 9).
    <DashboardData>
      <div className="flex flex-col gap-5">
        <Greeting />

        <section aria-label="Summary" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[20px] border border-[#E3E8DC] bg-white p-5">
              <div className="flex items-center gap-2.5">
                <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${s.chip}`}>
                  <s.icon className="h-[18px] w-[18px]" />
                </span>
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{s.label}</p>
              </div>
              <p className={`mt-3 text-[28px] font-extrabold tracking-tight ${s.valueClass}`}>{s.value}</p>
              {"bar" in s ? (
                <div className="mt-2.5 h-2 overflow-hidden rounded bg-[#EEF2E2]">
                  <div className="h-full rounded bg-leaf" style={{ width: `${s.bar}%` }} />
                </div>
              ) : (
                <p className="mt-1 text-[13px] text-muted">{s.note}</p>
              )}
            </div>
          ))}
        </section>

        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
            <GroupsCard />

            <RecentActivity />
          </div>

          <NeedsAttention />
        </div>
      </div>
    </DashboardData>
  );
}
