"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Avatar from "@/components/Avatar";
import { signOut } from "@/app/(app)/actions";
import { LogOutIcon } from "./icons";
import { MENU, PREFERENCES } from "./nav";
import { useProfile } from "./ProfileContext";

// Sidebar contents: menu, preferences, payment handles and profile card.
// Shown as a fixed sidebar on desktop and as the drop-down menu on phones.
export default function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const profile = useProfile();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const itemClass = (active: boolean) =>
    `flex h-11 items-center gap-3 rounded-xl px-3 font-semibold transition ${
      active ? "bg-tint font-bold text-ink" : "text-ink hover:bg-mist"
    }`;

  const zellePretty = profile.zelle?.startsWith("+1")
    ? `(${profile.zelle.slice(2, 5)}) ${profile.zelle.slice(5, 8)}-${profile.zelle.slice(8)}`
    : profile.zelle;
  const handles = [
    { label: "Venmo", value: profile.venmo ? `@${profile.venmo}` : null, dot: "bg-leaf" },
    { label: "PayPal", value: profile.paypal ? `paypal.me/${profile.paypal}` : null, dot: "bg-[#E3B341]" },
    { label: "Zelle", value: zellePretty, dot: "bg-sage" },
  ].filter((h) => h.value);

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Menu</p>
        {MENU.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={itemClass(active)}
            >
              <item.icon className={`h-5 w-5 shrink-0 ${active ? "text-brand" : "text-muted"}`} />
              <span className="grow">{item.label}</span>
              {"badge" in item && (
                <span className="rounded-md bg-butter-strong px-2 py-0.5 text-[11px] font-bold tracking-wide text-[#5C4A0B]">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Preferences</p>
        {PREFERENCES.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={itemClass(active)}
            >
              <item.icon className={`h-5 w-5 shrink-0 ${active ? "text-brand" : "text-muted"}`} />
              <span className="grow">{item.label}</span>
            </Link>
          );
        })}
        <form action={signOut}>
          <button type="submit" className={`${itemClass(false)} w-full text-left`}>
            <LogOutIcon className="h-5 w-5 shrink-0 text-muted" />
            <span className="grow">Log out</span>
          </button>
        </form>
      </div>

      <div className="mt-auto flex flex-col gap-2.5">
        <section aria-label="Your payment handles" className="rounded-2xl border border-line bg-mist p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Payment handles</p>
            <Link href="/settings" onClick={onNavigate} className="text-xs font-bold text-brand hover:underline">
              {handles.length ? "Edit" : "Add"}
            </Link>
          </div>
          {handles.length ? (
            <ul className="mt-2.5 flex flex-col gap-2 text-[13px]">
              {handles.map((h) => (
                <li key={h.label} className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${h.dot}`} aria-hidden="true" />
                  <span className="w-[52px] shrink-0 font-bold text-ink">{h.label}</span>
                  <span className="min-w-0 truncate text-[#3E4A43]">{h.value}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Add Venmo, PayPal or Zelle so friends can pay you.</p>
          )}
        </section>

        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-2xl bg-cream p-3 text-ink transition hover:bg-butter"
        >
          <Avatar src={profile.avatarUrl} size={44} alt="" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold">
              {profile.firstName} {profile.lastName}
            </span>
            <span className="truncate text-[13px] text-muted">@{profile.username}</span>
          </span>
          <span className="ml-auto text-[13px] font-semibold text-brand">Profile</span>
        </Link>
      </div>
    </div>
  );
}
