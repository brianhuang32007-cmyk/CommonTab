import { signedLinks } from "@/lib/signedLinks";
import type { createClient } from "@/lib/supabase/client";

// Group pictures are private: storage only lets the group's members open them.

/** Resolves with a link for each group picture path it could open (others are left out). */
export function groupPictureLinks(supabase: ReturnType<typeof createClient>, paths: (string | null | undefined)[]) {
  return signedLinks(supabase, "group-pictures", paths);
}
