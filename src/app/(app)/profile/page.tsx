import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Card from "@/components/app/Card";
import { createClient } from "@/lib/supabase/server";
import { formatUsPhone } from "@/lib/profile";
import EditProfileForm from "./EditProfileForm";

export const metadata = { title: "Profile · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function ProfilePage() {
  // Render per request: the login check below reads the current time (token expiry).
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/");

  const { data: p } = await supabase
    .from("profiles")
    .select("username, first_name, last_name, birthday, phone, avatar_url")
    .eq("id", userId)
    .maybeSingle();
  if (!p) redirect("/onboarding");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/preferences" className="self-start text-sm font-semibold text-brand hover:underline">
        ← Back to Preferences
      </Link>
      <Card title="Edit profile" description="Your photo and name are what friends see on CommonTab.">
        <EditProfileForm
          initial={{
            userId,
            username: p.username,
            firstName: p.first_name,
            lastName: p.last_name,
            birthday: p.birthday,
            phone: formatUsPhone(p.phone),
            avatarUrl: p.avatar_url,
          }}
        />
      </Card>
    </div>
  );
}
