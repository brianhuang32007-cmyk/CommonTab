"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  birthdayProblem,
  nameProblem,
  normalizePaypal,
  normalizeUsername,
  normalizeUsPhone,
  normalizeVenmo,
  normalizeZelle,
  paypalProblem,
  phoneProblem,
  usernameProblem,
  venmoProblem,
  zelleProblem,
} from "@/lib/profile";

type Field = "username" | "phone" | "firstName" | "lastName" | "birthday" | "venmo" | "paypal" | "zelle";

export type CreateProfileState = {
  error?: string;
  fieldErrors?: Partial<Record<Field, string>>;
};

export async function createProfile(input: {
  username: string;
  firstName: string;
  lastName: string;
  birthday: string;
  avatarPath: string | null;
  phone: string;
  venmo: string;
  paypal: string;
  zelle: string;
}): Promise<CreateProfileState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { error: "Your session ended. Please sign up or log in again." };

  const username = normalizeUsername(input.username);
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();

  const fieldErrors: CreateProfileState["fieldErrors"] = {};
  const u = usernameProblem(username);
  if (u) fieldErrors.username = u;
  const f = nameProblem(firstName);
  if (f) fieldErrors.firstName = f;
  const l = nameProblem(lastName);
  if (l) fieldErrors.lastName = l;
  const b = birthdayProblem(input.birthday);
  if (b) fieldErrors.birthday = b;

  const phone = normalizeUsPhone(input.phone);
  const ph = phoneProblem(phone);
  if (ph) fieldErrors.phone = ph;

  const venmo = normalizeVenmo(input.venmo);
  const paypal = normalizePaypal(input.paypal);
  const zelle = normalizeZelle(input.zelle);
  const v = venmoProblem(venmo);
  if (v) fieldErrors.venmo = v;
  const p = paypalProblem(paypal);
  if (p) fieldErrors.paypal = p;
  const z = zelleProblem(zelle);
  if (z) fieldErrors.zelle = z;

  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // A photo must sit in this user's own folder (storage rules enforce this too).
  let avatarUrl: string | null = null;
  if (input.avatarPath) {
    if (!input.avatarPath.startsWith(`${userId}/`)) return { error: "That photo upload isn't valid." };
    avatarUrl = supabase.storage.from("avatars").getPublicUrl(input.avatarPath).data.publicUrl;
  }

  const { error } = await supabase.from("profiles").insert({
    id: userId,
    username,
    first_name: firstName,
    last_name: lastName,
    birthday: input.birthday,
    avatar_url: avatarUrl,
    phone: phone || null,
    venmo_username: venmo || null,
    paypal_username: paypal || null,
    zelle_contact: zelle || null,
  });

  if (error) {
    if (error.code === "23505") {
      // Unique violation: either the username is taken, or this account already has a profile.
      if (error.message.includes("username")) {
        return { fieldErrors: { username: "That username was just taken. Try another." } };
      }
      redirect("/dashboard");
    }
    return { error: "Couldn't save your profile. Please try again." };
  }

  redirect("/dashboard");
}
