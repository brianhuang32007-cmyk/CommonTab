import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "./ProfileForm";

export const metadata = { title: "Create your profile · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect("/");

  // Already finished? Go straight to the dashboard.
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", claims.sub).maybeSingle();
  if (profile) redirect("/dashboard");

  // Google gives us a name; use it to pre-fill the form.
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const [firstGuess = "", ...rest] = fullName.split(/\s+/).filter(Boolean);

  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-14">
      <Logo />
      <div className="mt-8 w-full max-w-lg rounded-3xl bg-white p-6 shadow-sm ring-1 ring-line sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Create your profile</h1>
        <p className="mt-1 text-sm text-muted">
          Signed in as <span className="font-semibold text-ink">{claims.email}</span>. Friends find you by
          your username.
        </p>
        <ProfileForm userId={claims.sub} defaultFirstName={firstGuess} defaultLastName={rest.join(" ")} />
      </div>
    </main>
  );
}
