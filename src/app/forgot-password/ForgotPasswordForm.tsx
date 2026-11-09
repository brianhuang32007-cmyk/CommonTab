"use client";

import { useState } from "react";
import { MailIcon } from "@/components/landing/icons";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many requests. Please wait a few minutes and try again."
          : "Couldn't send the link right now. Please try again.",
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div role="status" className="mt-6 rounded-2xl bg-mist p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint/60 text-brand">
            <MailIcon className="h-5 w-5" />
          </span>
          <p className="font-semibold text-ink">Check your inbox</p>
        </div>
        <p className="mt-3 text-sm text-muted">
          If an account exists for <span className="font-semibold text-ink">{email.trim()}</span>, we sent a link to
          reset your password. Open it in this browser.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-3 text-sm font-semibold text-brand hover:text-brand-hover hover:underline"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={sendLink} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="forgot-email" className="mb-1 block text-sm font-semibold text-ink">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          className="h-12 w-full rounded-xl border border-line bg-white px-4 text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
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
        {busy ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
