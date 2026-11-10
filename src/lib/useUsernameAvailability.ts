"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usernameProblem } from "@/lib/profile";

export type Availability = "idle" | "checking" | "available" | "taken" | "error";

/**
 * Live "is this username free?" check, a moment after typing stops.
 * `normalized` is the cleaned-up username; `current` is the user's own username
 * (when editing), which always counts as fine.
 */
export function useUsernameAvailability(normalized: string, current?: string) {
  // Last answer from the database: which name we asked about, and whether it's free.
  const [lastCheck, setLastCheck] = useState<{ name: string; status: Availability } | null>(null);

  const formatError = normalized ? usernameProblem(normalized) : null;
  const isOwn = Boolean(current) && normalized === current;
  const canCheck = Boolean(normalized) && !formatError && !isOwn;
  const availability: Availability = !canCheck
    ? "idle"
    : lastCheck?.name === normalized
      ? lastCheck.status
      : "checking";

  useEffect(() => {
    if (!canCheck) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await createClient().rpc("is_username_available", { candidate: normalized });
      if (cancelled) return;
      setLastCheck({ name: normalized, status: error ? "error" : data ? "available" : "taken" });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalized, canCheck]);

  return { availability, formatError, isOwn };
}
