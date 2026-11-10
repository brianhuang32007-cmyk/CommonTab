"use client";

import { createContext, useContext } from "react";

export type AppProfile = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  venmo: string | null;
  paypal: string | null;
  zelle: string | null;
};

const ProfileContext = createContext<AppProfile | null>(null);

export const ProfileProvider = ProfileContext.Provider;

/** The signed-in user's profile, available to every page inside the app frame. */
export function useProfile() {
  const profile = useContext(ProfileContext);
  if (!profile) throw new Error("useProfile must be used inside the app frame");
  return profile;
}
