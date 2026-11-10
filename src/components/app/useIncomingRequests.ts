"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Live count of contact requests waiting for this user (for the sidebar badge). */
export function useIncomingRequests(userId: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { count: n } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("addressee_id", userId)
        .eq("status", "pending");
      if (!cancelled) setCount(n ?? 0);
    }

    load();
    // Any change to a row that includes this user (Realtime only sends those) → recount.
    const channel = supabase
      .channel(`request-badge-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => load())
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return count;
}
