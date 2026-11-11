import { NeedsAttention, RecentActivity } from "./ActivityCards";
import { DashboardData } from "./DashboardData";
import GroupsCard from "./GroupsCard";
import Greeting from "./Greeting";
import SummaryCards from "./SummaryCards";

export const metadata = { title: "Dashboard · CommonTab" };

export default function DashboardPage() {
  return (
    // Everything here is live: groups match the Group page, and the money cards, tasks and
    // activity come from the same alerts source as the bell and Alerts & Reminders.
    <DashboardData>
      <div className="flex flex-col gap-5">
        <Greeting />

        <SummaryCards />

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
