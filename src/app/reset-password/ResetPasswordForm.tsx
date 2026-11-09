"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import { MIN_PASSWORD } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(
        error.code === "same_password"
          ? "Choose a password you haven't used before."
          : error.code === "weak_password"
            ? "That password is too weak. Try a longer one."
            : error.code === "session_not_found" || error.status === 401
              ? "This reset link has expired. Request a new one from the log in page."
              : "Couldn't update your password. Please try again.",
      );
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.replace("/dashboard");
      router.refresh();
    }, 1200);
  }

  if (done) {
    return (
      <p role="status" className="mt-6 rounded-lg bg-mint/50 px-3 py-3 text-sm font-semibold text-ink">
        Password updated. Taking you to your dashboard…
      </p>
    );
  }

  return (
    <form onSubmit={save} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="new-password" className="mb-1 block text-sm font-semibold text-ink">
          New password
        </label>
        <PasswordInput
          id="new-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          describedBy="new-password-hint"
        />
        <p id="new-password-hint" className="mt-1 text-xs text-muted">
          At least {MIN_PASSWORD} characters.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="mb-1 block text-sm font-semibold text-ink">
          Confirm new password
        </label>
        <PasswordInput
          id="confirm-password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={Boolean(confirm) && confirm !== password}
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
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
