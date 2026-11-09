import { redirect } from "next/navigation";
import Avatar from "@/components/Avatar";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export const metadata = { title: "Dashboard · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, first_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo className="h-8 w-auto" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm font-semibold text-ink sm:inline">@{profile.username}</span>
            <Avatar src={profile.avatar_url} size={36} alt={`${profile.first_name}'s profile photo`} />
            <form action={signOut}>
              <button type="submit" className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-mist hover:text-ink">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* Dashboard content comes in a later step. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6" />
    </div>
  );
}
