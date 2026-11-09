"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import { MIN_PASSWORD } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { ArrowRightIcon, GoogleIcon, MailIcon } from "./icons";

type View = "choose" | "email" | "check-inbox";

export default function SignupCard() {
  const router = useRouter();
  const [view, setView] = useState<View>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=/onboarding`;

  async function signUpWithGoogle() {
    setError("");
    setBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    // On success the browser leaves for Google, so we only get here on failure.
    if (error) {
      setError("Couldn't open Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  async function signUpWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);

    if (error) {
      setError(error.message);
      return;
    }
    // Supabase returns a user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) {
      setError("An account with this email already exists. Log in instead, or reset your password if you forgot it.");
      return;
    }
    if (data.session) {
      router.push("/onboarding"); // email confirmation is turned off
      return;
    }
    setView("check-inbox");
  }

  const primaryButton =
    "flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const input =
    "h-12 w-full rounded-xl border border-line bg-white px-4 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

  return (
    <div
      id="signup"
      className="w-full max-w-md scroll-mt-24 rounded-3xl bg-white/95 p-6 text-left shadow-2xl shadow-night/30 ring-1 ring-black/5 backdrop-blur sm:p-8"
    >
      {view === "check-inbox" ? (
        <div role="status">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-mint/60 text-brand">
            <MailIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-ink">Check your inbox</h2>
          <p className="mt-2 text-muted">
            We sent a confirmation link to <span className="font-semibold text-ink">{email.trim()}</span>.
            Open it in this browser to create your profile.
          </p>
          <button
            type="button"
            onClick={() => {
              setView("email");
              setPassword("");
            }}
            className="mt-6 text-sm font-semibold text-brand hover:text-brand-hover hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <>
          <h2 className="text-2xl font-bold tracking-tight text-ink">Sign up for free</h2>
          <p className="mt-1 text-sm text-muted">Create your account in a minute.</p>

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={signUpWithGoogle}
              disabled={busy}
              className="flex h-12 items-center justify-center gap-3 rounded-xl border border-line bg-white px-4 font-semibold text-ink transition hover:bg-mist disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <GoogleIcon className="h-5 w-5" />
              Sign up with Google
            </button>

            {view === "choose" ? (
              <button type="button" onClick={() => setView("email")} className={primaryButton}>
                <MailIcon className="h-5 w-5" />
                Sign up with email
              </button>
            ) : (
              <form onSubmit={signUpWithEmail} className="flex flex-col gap-3">
                <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
                  <span className="h-px flex-1 bg-line" />
                  or with email
                  <span className="h-px flex-1 bg-line" />
                </div>
                <div>
                  <label htmlFor="signup-email" className="mb-1 block text-sm font-semibold text-ink">
                    Email
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@school.edu"
                    className={input}
                  />
                </div>
                <div>
                  <label htmlFor="signup-password" className="mb-1 block text-sm font-semibold text-ink">
                    Password
                  </label>
                  <PasswordInput
                    id="signup-password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    describedBy="signup-password-hint"
                  />
                  <p id="signup-password-hint" className="mt-1 text-xs text-muted">
                    At least {MIN_PASSWORD} characters.
                  </p>
                </div>
                <button type="submit" disabled={busy} className={primaryButton}>
                  {busy ? "Creating account…" : "Create account"}
                  {!busy && <ArrowRightIcon className="h-4 w-4" />}
                </button>
              </form>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-warn">
              {error}
            </p>
          )}

          <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand hover:text-brand-hover hover:underline">
              Log in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
