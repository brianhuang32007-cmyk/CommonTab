"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  normalizePaypal,
  normalizeVenmo,
  normalizeZelle,
  paypalProblem,
  venmoProblem,
  zelleProblem,
} from "@/lib/profile";
import type { PaymentProvider } from "@/components/app/PaymentLogos";

export type SaveResult = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<PaymentProvider, string>>;
};

const SESSION_ENDED = "Your session ended. Please log in again.";
const SAVE_FAILED = "Couldn't save. Please try again.";

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return { supabase, userId: data?.claims?.sub ?? null };
}

export async function saveHandles(input: {
  venmo: string;
  paypal: string;
  zelle: string;
  preferred: PaymentProvider | null;
}): Promise<SaveResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: SESSION_ENDED };

  const values: Record<PaymentProvider, string> = {
    venmo: normalizeVenmo(input.venmo),
    paypal: normalizePaypal(input.paypal),
    zelle: normalizeZelle(input.zelle),
  };
  const fieldErrors: SaveResult["fieldErrors"] = {};
  const v = venmoProblem(values.venmo);
  if (v) fieldErrors.venmo = v;
  const p = paypalProblem(values.paypal);
  if (p) fieldErrors.paypal = p;
  const z = zelleProblem(values.zelle);
  if (z) fieldErrors.zelle = z;
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // "Show first" only makes sense for a handle that's filled in.
  const preferred = input.preferred && values[input.preferred] ? input.preferred : null;

  const { error } = await supabase
    .from("profiles")
    .update({
      venmo_username: values.venmo || null,
      paypal_username: values.paypal || null,
      zelle_contact: values.zelle || null,
      preferred_handle: preferred,
    })
    .eq("id", userId);
  if (error) return { error: SAVE_FAILED };

  refresh(); // updates the sidebar's handles box
  return { ok: true };
}

export async function saveReminders(input: {
  threeDays: boolean;
  oneDay: boolean;
  overdue: boolean;
}): Promise<SaveResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: SESSION_ENDED };

  const { error } = await supabase
    .from("profiles")
    .update({
      remind_3_days: Boolean(input.threeDays),
      remind_1_day: Boolean(input.oneDay),
      remind_overdue: Boolean(input.overdue),
    })
    .eq("id", userId);
  return error ? { error: SAVE_FAILED } : { ok: true };
}

export async function savePrivacy(input: {
  discoverableBy: "everyone" | "contacts";
  showPhone: boolean;
}): Promise<SaveResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: SESSION_ENDED };

  const discoverableBy = input.discoverableBy === "contacts" ? "contacts" : "everyone";
  const { error } = await supabase
    .from("profiles")
    .update({ discoverable_by: discoverableBy, show_phone: Boolean(input.showPhone) })
    .eq("id", userId);
  return error ? { error: SAVE_FAILED } : { ok: true };
}

/** Deletes the account right away. The person confirms by typing their username. */
export async function deleteAccount(confirmUsername: string): Promise<SaveResult> {
  const { supabase, userId } = await signedIn();
  if (!userId) return { error: SESSION_ENDED };

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", userId).maybeSingle();
  const typed = confirmUsername.trim().replace(/^@/, "").toLowerCase();
  if (!profile || typed !== profile.username) {
    return { error: "That doesn't match your username." };
  }

  // Remove their profile photos first (the database can't delete stored files).
  const { data: files } = await supabase.storage.from("avatars").list(userId);
  if (files?.length) {
    await supabase.storage.from("avatars").remove(files.map((f) => `${userId}/${f.name}`));
  }

  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error: "Couldn't delete your account. Please try again." };

  // The login no longer exists; clear this browser's login cookies.
  await supabase.auth.signOut().catch(() => {});
  const jar = await cookies();
  jar.getAll().forEach((c) => {
    if (c.name.startsWith("sb-")) jar.delete(c.name);
  });

  redirect("/");
}
