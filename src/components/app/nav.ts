import { BellIcon, BoltIcon, ChatIcon, ContactsIcon, DocumentIcon, HomeIcon, SettingsIcon } from "./icons";

// The app's pages, in sidebar order. Titles also appear in the top bar.
export const MENU = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/group", label: "Group", icon: ChatIcon },
  { href: "/contacts", label: "Contacts", icon: ContactsIcon },
  { href: "/ai", label: "CommonTab AI", icon: BoltIcon, badge: "NEW" },
  { href: "/documents", label: "Document Drafting", icon: DocumentIcon },
  { href: "/notifications", label: "Alerts & Reminders", icon: BellIcon },
] as const;

export const PREFERENCES = [{ href: "/preferences", label: "Preferences", icon: SettingsIcon }] as const;

// Pages that aren't in the sidebar but still need a title.
const OTHER_PAGES = [{ href: "/profile", label: "Profile" }] as const;

export function pageTitle(pathname: string) {
  const item = [...MENU, ...PREFERENCES, ...OTHER_PAGES].find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return item?.label ?? "CommonTab";
}
