import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import Avatar from "@/components/Avatar";
import Card from "@/components/app/Card";
import type { PaymentProvider } from "@/components/app/PaymentLogos";
import { secondaryButton } from "@/components/forms";
import { createClient } from "@/lib/supabase/server";
import AccountSection from "./AccountSection";
import HandlesForm from "./HandlesForm";
import PrivacyForm from "./PrivacyForm";
import RemindersForm from "./RemindersForm";

export const metadata = { title: "Preferences · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function PreferencesPage() {
  // Render per request: the login check below reads the current time (token expiry).
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const claims = auth?.claims;
  if (!claims) redirect("/");

  const { data: p, error } = await supabase
    .from("profiles")
    .select(
      "username, first_name, last_name, avatar_url, phone, venmo_username, paypal_username, zelle_contact, preferred_handle, remind_3_days, remind_1_day, remind_overdue, discoverable_by, show_phone",
    )
    .eq("id", claims.sub)
    .maybeSingle();

  if (error || !p) {
    return (
      <section className="rounded-3xl border border-line bg-white px-6 py-12 text-center">
        <p className="font-bold text-ink">Preferences aren&apos;t ready yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          The database needs the new preferences update (supabase/migrations/20261110000000_preferences.sql).
        </p>
        {process.env.NODE_ENV === "development" && error && (
          <p className="mx-auto mt-3 max-w-md font-mono text-xs text-muted">
            {error.code}: {error.message}
          </p>
        )}
      </section>
    );
  }

  const providers = (claims.app_metadata?.providers as string[] | undefined) ?? [];
  const hasPassword = providers.includes("email") || claims.app_metadata?.provider === "email";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      {/* Profile summary */}
      <section className="flex flex-wrap items-center gap-4 rounded-3xl bg-cream p-5 sm:p-6">
        <Avatar src={p.avatar_url} name={`${p.first_name} ${p.last_name}`} seed={claims.sub} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold text-ink sm:text-xl">
            {p.first_name} {p.last_name}
          </p>
          <p className="truncate text-sm text-muted">@{p.username}</p>
        </div>
        <Link href="/profile" className={`${secondaryButton} bg-white`}>
          Edit Profile
        </Link>
      </section>

      <Card
        id="payment-handles"
        title="Payment handles"
        description="Friends use these to pay you. Add any, all or none."
      >
        <HandlesForm
          initial={{
            venmo: p.venmo_username ?? "",
            paypal: p.paypal_username ?? "",
            zelle: p.zelle_contact ?? "",
            preferred: (p.preferred_handle as PaymentProvider | null) ?? null,
          }}
        />
      </Card>

      <Card id="reminders" title="Reminders" description="When to remind you about payments you owe.">
        <RemindersForm
          initial={{ threeDays: p.remind_3_days, oneDay: p.remind_1_day, overdue: p.remind_overdue }}
        />
      </Card>

      <Card id="privacy" title="Privacy" description="Control who can find you and what they see.">
        <PrivacyForm
          initial={{
            discoverableBy: p.discoverable_by === "groups" || p.discoverable_by === "contacts" ? "groups" : "everyone",
            showPhone: p.show_phone,
          }}
          hasPhone={Boolean(p.phone)}
        />
      </Card>

      <Card id="account" title="Account">
        <AccountSection email={claims.email ?? ""} hasPassword={hasPassword} username={p.username} />
      </Card>
    </div>
  );
}
