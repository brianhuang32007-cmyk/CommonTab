"use client";

import { useState, useTransition } from "react";
import PasswordInput from "@/components/PasswordInput";
import { borderFor, FormMessage, inputClass, primaryButton, secondaryButton } from "@/components/forms";
import { LogOutIcon } from "@/components/app/icons";
import { signOut } from "@/app/(app)/actions";
import { createClient } from "@/lib/supabase/client";
import { MIN_PASSWORD } from "@/lib/profile";
import { deleteAccount } from "./actions";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function AccountSection({
  email,
  hasPassword,
  username,
}: {
  email: string;
  /** False for people who only sign in with Google. */
  hasPassword: boolean;
  username: string;
}) {
  return (
    <div className="flex flex-col divide-y divide-line">
      <EmailRow email={email} hasPassword={hasPassword} />
      {hasPassword && <PasswordRow email={email} />}
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <p className="font-semibold text-ink">Log out</p>
          <p className="text-[13px] text-muted">Sign out of CommonTab on this device.</p>
        </div>
        <form action={signOut}>
          <button type="submit" className={`${secondaryButton} gap-2`}>
            <LogOutIcon className="h-4 w-4" />
            Log Out
          </button>
        </form>
      </div>
      <DeleteRow username={username} />
    </div>
  );
}

function EmailRow({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = newEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(next)) return setError("Enter a valid email address.");
    if (next === email.toLowerCase()) return setError("That's already your email.");
    setError("");
    startTransition(async () => {
      const { error } = await createClient().auth.updateUser(
        { email: next },
        { emailRedirectTo: `${window.location.origin}/auth/callback?next=/preferences` },
      );
      if (error) setError(error.message || "Couldn't send the confirmation email. Please try again.");
      else {
        setSentTo(next);
        setOpen(false);
        setNewEmail("");
      }
    });
  }

  return (
    <div className="py-4 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">Email</p>
          <p className="truncate text-[13px] text-muted">
            {email}
            {!hasPassword && " · Signed in with Google"}
          </p>
        </div>
        {hasPassword && !open && (
          <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
            Change Email
          </button>
        )}
      </div>

      {sentTo && (
        <div className="mt-3">
          <FormMessage
            success={`Check ${sentTo} for a confirmation link. Your email changes once you confirm.`}
          />
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor="new-email" className="mb-1 block text-sm font-semibold text-ink">
              New email
            </label>
            <input
              id="new-email"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError("");
              }}
              aria-invalid={Boolean(error)}
              className={`${inputClass} ${borderFor(error)}`}
            />
          </div>
          <FormMessage error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Sending…" : "Send Confirmation"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
              className="h-12 rounded-xl px-4 font-semibold text-muted hover:bg-mist"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordRow({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setError("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!current) return setError("Enter your current password.");
    if (next.length < MIN_PASSWORD) return setError(`Your new password needs at least ${MIN_PASSWORD} characters.`);
    if (next === current) return setError("Choose a password different from your current one.");
    setError("");
    startTransition(async () => {
      const supabase = createClient();
      // Check the current password before changing it.
      const check = await supabase.auth.signInWithPassword({ email, password: current });
      if (check.error) return setError("Your current password isn't right.");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) return setError(error.message || "Couldn't change your password. Please try again.");
      close();
      setDone(true);
    });
  }

  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Password</p>
          <p className="text-[13px] text-muted">At least {MIN_PASSWORD} characters.</p>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setDone(false);
            }}
            className={secondaryButton}
          >
            Change Password
          </button>
        )}
      </div>

      {done && (
        <div className="mt-3">
          <FormMessage success="Password changed." />
        </div>
      )}

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3" noValidate>
          <div>
            <label htmlFor="current-password" className="mb-1 block text-sm font-semibold text-ink">
              Current password
            </label>
            <PasswordInput
              id="current-password"
              value={current}
              onChange={(v) => {
                setCurrent(v);
                setError("");
              }}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm font-semibold text-ink">
              New password
            </label>
            <PasswordInput
              id="new-password"
              value={next}
              onChange={(v) => {
                setNext(v);
                setError("");
              }}
              autoComplete="new-password"
            />
          </div>
          <FormMessage error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Saving…" : "Change Password"}
            </button>
            <button type="button" onClick={close} className="h-12 rounded-xl px-4 font-semibold text-muted hover:bg-mist">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DeleteRow({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const matches = typed.trim().replace(/^@/, "").toLowerCase() === username;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!matches) return setError("Type your username exactly to confirm.");
    startTransition(async () => {
      // Success signs you out and goes to the home page; we only get a result back on failure.
      const res = await deleteAccount(typed);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-ink">Delete account</p>
          <p className="text-[13px] text-muted">Permanently delete your account and everything in it.</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
            Delete Account
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-3 rounded-2xl bg-butter p-4" noValidate>
          <p className="text-sm font-semibold text-honey">
            This deletes your account right away: your profile, photo and payment handles. It can&apos;t be undone.
          </p>
          <div>
            <label htmlFor="confirm-username" className="mb-1 block text-sm font-semibold text-ink">
              Type <span className="font-bold">@{username}</span> to confirm
            </label>
            <input
              id="confirm-username"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
                setError("");
              }}
              aria-invalid={Boolean(error)}
              className={`${inputClass} ${borderFor(error)}`}
            />
          </div>
          <FormMessage error={error} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || !matches}
              className="flex h-12 items-center justify-center rounded-xl bg-ink px-5 font-semibold text-white transition hover:bg-black disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete My Account"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError("");
              }}
              className="h-12 rounded-xl px-4 font-semibold text-ink hover:bg-butter-strong"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
