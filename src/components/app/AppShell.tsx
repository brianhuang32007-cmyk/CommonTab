"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BoltIcon, CloseIcon, MenuIcon } from "./icons";
import { pageTitle } from "./nav";
import { ProfileProvider, type AppProfile } from "./ProfileContext";
import SideNav from "./SideNav";
import TopBar from "./TopBar";
import { useIncomingRequests } from "./useIncomingRequests";

export default function AppShell({ profile, children }: { profile: AppProfile; children: React.ReactNode }) {
  const requestCount = useIncomingRequests(profile.id);
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <ProfileProvider value={profile}>
      <div className="flex min-h-full flex-1 bg-mist">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[280px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-line bg-white px-4 py-6 lg:flex">
          <Link href="/dashboard" aria-label="CommonTab dashboard" className="px-2">
            <Image
              src="/brand/commontab-logo.svg"
              alt="CommonTab — Social Finance"
              width={927}
              height={172}
              unoptimized
              className="h-10 w-auto"
            />
          </Link>
          <nav aria-label="Main" className="flex grow flex-col">
            <SideNav requestCount={requestCount} />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone header with drop-down menu */}
          <div className="sticky top-0 z-30 lg:hidden">
            <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
              <Link href="/dashboard" aria-label="CommonTab dashboard" className="shrink-0">
                <Image src="/brand/commontab-mark.svg" alt="" width={36} height={36} unoptimized className="h-9 w-9" />
              </Link>
              <p className="min-w-0 grow truncate text-[22px] font-extrabold tracking-tight text-ink">{pageTitle(pathname)}</p>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-controls="phone-menu"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-ink"
              >
                {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
              </button>
            </div>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={closeMenu}
                  className="fixed inset-0 top-[69px] z-0 bg-night/20"
                />
                <nav
                  id="phone-menu"
                  aria-label="Main"
                  className="absolute inset-x-0 top-full z-10 max-h-[calc(100vh-69px)] overflow-y-auto border-b border-line bg-white px-4 pb-5 pt-4 shadow-lg"
                >
                  <SideNav onNavigate={closeMenu} requestCount={requestCount} />
                </nav>
              </>
            )}
          </div>

          <div className="mx-auto w-full max-w-[1240px] px-4 pb-24 sm:px-8">
            <TopBar />
            <main className="pt-6">{children}</main>
          </div>
        </div>
      </div>

      {/* CommonTab AI shortcut (hidden on the AI page itself) */}
      {pathname !== "/ai" && (
        <Link
          href="/ai"
          className="fixed bottom-5 right-5 z-20 flex h-[52px] items-center gap-2 rounded-full bg-brand px-5 font-bold text-white shadow-lg shadow-night/20 transition hover:bg-brand-hover"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-butter-strong text-[#5C4A0B]">
            <BoltIcon className="h-4 w-4" />
          </span>
          Ask CommonTab AI
        </Link>
      )}
    </ProfileProvider>
  );
}
