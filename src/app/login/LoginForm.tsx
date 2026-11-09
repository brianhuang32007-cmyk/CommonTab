"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import { GoogleIcon } from "@/components/landing/icons";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logInWithGoogle() {
    setError("");
    setBusy(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) {
      setError("Couldn't open Google sign-in. Please try again.");
      setBusy(false);
    }
  }

  async function logInWithEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setBusy(false);
      setError(
        error.code === "email_not_confirmed"
          ? "Please confirm your email first. Check your inbox for the link we sent."
          : error.code === "invalid_credentials"
            ? "Wrong email or password."
            : "Couldn't log in right now. Please try again.",
      );
      return;
    }
    // The dashboard sends people without a profile to finish setting one up.
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <button
        type="button"
        onClick={logInWithGoogle}
        disabled={busy}
        className="flex h-12 items-center justify-center gap-3 rounded-xl border border-line bg-white px-4 font-semibold text-ink transition hover:bg-mist disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={logInWithEmail} className="flex flex-col gap-4">
        <div>
          <label htmlFor="login-email" className="mb-1 block text-sm font-semibold text-ink">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@school.edu"
            className="h-12 w-full rounded-xl border border-line bg-white px-4 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="login-password" className="text-sm font-semibold text-ink">
              Password
            </label>
            <Link href="/forgot-password" className="text-sm font-semibold text-brand hover:text-brand-hover hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-warn">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="flex h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </div>
  );
}
