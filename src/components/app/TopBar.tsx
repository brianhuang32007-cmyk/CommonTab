"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AddContactIcon } from "./icons";
import LiveClock from "./LiveClock";
import { pageTitle } from "./nav";

// Top bar: page title on the left, live clock in the center, the page's main action on the right.
// On phones the title lives in the header above, so this shows the clock (and action) only.
export default function TopBar() {
  const pathname = usePathname();
  const title = pageTitle(pathname);
  const action =
    pathname === "/dashboard" ? (
      <Link
        href="/contacts#add-contact"
        className="inline-flex h-12 items-center gap-2.5 rounded-[14px] bg-brand px-6 text-lg font-bold text-white transition hover:bg-brand-hover lg:h-[52px]"
      >
        <AddContactIcon className="h-[22px] w-[22px]" />
        Add Contact
      </Link>
    ) : null;

  return (
    <header className="border-b border-line py-5">
      {/* Desktop */}
      <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 lg:grid">
        <h1 className="justify-self-start text-[32px] leading-[52px] font-extrabold tracking-tight text-ink">{title}</h1>
        <LiveClock />
        <div className="justify-self-end">{action}</div>
      </div>
      {/* Phone / tablet */}
      <div className="flex flex-col items-center gap-4 lg:hidden">
        <LiveClock size="sm" />
        {action && <div className="flex w-full justify-center">{action}</div>}
      </div>
    </header>
  );
}
