"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  birthdayProblem,
  nameProblem,
  normalizeUsername,
  normalizeUsPhone,
  phoneProblem,
  usernameProblem,
} from "@/lib/profile";

type Field = "username" | "phone" | "firstName" | "lastName" | "birthday";

export type UpdateProfileResult = {
  ok?: boolean;
  avatarUrl?: string | null;
  error?: string;
  fieldErrors?: Partial<Record<Field, string>>;
};

export async function updateProfile(input: {
  username: string;
  firstName: string;
  lastName: string;
  birthday: string;
  phone: string;
  /** keep the current photo, remove it, or use a newly uploaded file at this storage path */
  photo: { action: "keep" } | { action: "remove" } | { action: "new"; path: string };
}): Promise<UpdateProfileResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "Your session ended. Please log in again." };

  const username = normalizeUsername(input.username);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = normalizeUsPhone(input.phone);

  const fieldErrors: UpdateProfileResult["fieldErrors"] = {};
  const u = usernameProblem(username);
  if (u) fieldErrors.username = u;
  const f = nameProblem(firstName);
  if (f) fieldErrors.firstName = f;
  const l = nameProblem(lastName);
  if (l) fieldErrors.lastName = l;
  const b = birthdayProblem(input.birthday);
  if (b) fieldErrors.birthday = b;
  const ph = phoneProblem(phone);
  if (ph) fieldErrors.phone = ph;
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const update: Record<string, string | null> = {
    username,
    first_name: firstName,
    last_name: lastName,
    birthday: input.birthday,
    phone: phone || null,
  };

  let keepFile: string | null = null; // the one photo file to keep after saving
  if (input.photo.action === "new") {
    // A photo must sit in this user's own folder (storage rules enforce this too).
    if (!input.photo.path.startsWith(`${userId}/`)) return { error: "That photo upload isn't valid." };
    update.avatar_url = supabase.storage.from("avatars").getPublicUrl(input.photo.path).data.publicUrl;
    keepFile = input.photo.path;
  } else if (input.photo.action === "remove") {
    update.avatar_url = null;
  }

  const { data: saved, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", userId)
    .select("avatar_url")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { fieldErrors: { username: "That username is taken. Try another." } };
    if (error.code === "23514" && error.message.includes("birthday")) {
      return { fieldErrors: { birthday: "Enter a real birthday (13 or older)." } };
    }
    return { error: "Couldn't save your profile. Please try again." };
  }

  // Tidy up photos that are no longer used.
  if (input.photo.action !== "keep") {
    const { data: files } = await supabase.storage.from("avatars").list(userId);
    const old = (files ?? []).map((file) => `${userId}/${file.name}`).filter((path) => path !== keepFile);
    if (old.length) await supabase.storage.from("avatars").remove(old);
  }

  refresh(); // updates the sidebar's name and photo
  return { ok: true, avatarUrl: saved?.avatar_url ?? null };
}
