import { BoltIcon, ChatIcon, ContactsIcon, DocumentIcon, HomeIcon, SettingsIcon } from "./icons";

// The app's pages, in sidebar order. Titles also appear in the top bar.
export const MENU = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/group", label: "Group", icon: ChatIcon },
  { href: "/contacts", label: "Contacts", icon: ContactsIcon },
  { href: "/ai", label: "CommonTab AI", icon: BoltIcon, badge: "NEW" },
  { href: "/documents", label: "Documents & Receipts", icon: DocumentIcon },
] as const;

export const PREFERENCES = [{ href: "/settings", label: "Settings", icon: SettingsIcon }] as const;

export function pageTitle(pathname: string) {
  const item = [...MENU, ...PREFERENCES].find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  return item?.label ?? "CommonTab";
}
