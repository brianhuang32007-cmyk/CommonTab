import { redirect } from "next/navigation";
import { connection } from "next/server";
import AppShell from "@/components/app/AppShell";
import type { AppProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/server";

// Every signed-in page (Dashboard, Group, Contacts, …) shares this frame:
// the sidebar, top bar and clock stay put while the page content changes.
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Render per request: the login check below reads the current time (token expiry).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/");

  const { data: row } = await supabase
    .from("profiles")
    .select("username, first_name, last_name, avatar_url, venmo_username, paypal_username, zelle_contact")
    .eq("id", userId)
    .maybeSingle();
  if (!row) redirect("/onboarding");

  const profile: AppProfile = {
    id: userId,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    avatarUrl: row.avatar_url,
    venmo: row.venmo_username,
    paypal: row.paypal_username,
    zelle: row.zelle_contact,
  };

  return <AppShell profile={profile}>{children}</AppShell>;
}
