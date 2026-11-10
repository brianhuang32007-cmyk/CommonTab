"use client";

import { usePathname } from "next/navigation";
import LiveClock from "./LiveClock";
import { pageTitle } from "./nav";
import NotificationBell from "./NotificationBell";

// Top bar: page title on the left, live clock in the center, the notification bell on the right.
// On phones the title and bell live in the header above, so this shows the clock only.
export default function TopBar() {
  const pathname = usePathname();
  const title = pageTitle(pathname);

  return (
    <header className="border-b border-line py-5">
      {/* Desktop */}
      <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 lg:grid">
        <h1 className="justify-self-start text-[32px] leading-[52px] font-extrabold tracking-tight text-ink">{title}</h1>
        <LiveClock />
        <div className="justify-self-end">
          <NotificationBell />
        </div>
      </div>
      {/* Phone / tablet */}
      <div className="flex flex-col items-center lg:hidden">
        <LiveClock size="sm" />
      </div>
    </header>
  );
}
