import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./ResetPasswordForm";

export const metadata = { title: "Reset password · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function ResetPasswordPage() {
  // The reset link signs the person in (via /auth/callback) before landing here.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email;

  if (!data?.claims) {
    return (
      <AuthCard title="This reset link has expired" subtitle="Reset links work once, for a limited time, in the browser where you requested them.">
        <Link
          href="/forgot-password"
          className="mt-6 flex h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-hover"
        >
          Send a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={
        email ? (
          <>
            For <span className="font-semibold text-ink">{email}</span>
          </>
        ) : undefined
      }
    >
      <ResetPasswordForm />
    </AuthCard>
  );
}
