"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useProfile } from "@/components/app/ProfileContext";
import { groupPictureLinks } from "@/lib/groupPictures";
import { createClient } from "@/lib/supabase/client";
import type { Conversation } from "../group/types";

// The dashboard's view of your groups: the same data as the Group page (my_conversations),
// kept live the same way, so both pages always agree.

export type DashboardGroups = { status: "loading" } | { status: "error"; retry: () => void } | { status: "ready"; groups: Conversation[] };

const Context = createContext<DashboardGroups>({ status: "loading" });

export function DashboardData({ children }: { children: React.ReactNode }) {
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; groups: Conversation[] }>({
    status: "loading",
  });

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("my_conversations");
    if (error) {
      // Keep what's on screen if a background refresh fails.
      setState((s) => (s.status === "ready" ? s : { status: "error" }));
      return;
    }
    const rows = ((data ?? []) as Omit<Conversation, "picture_url">[]).filter((c) => c.kind === "group");
    const links = await groupPictureLinks(
      supabase,
      rows.map((r) => r.picture_path),
    );
    setState({
      status: "ready",
      groups: rows.map((c) => ({
        ...c,
        unread_count: c.unread_count ?? 0,
        unread_mentions: c.unread_mentions ?? 0,
        picture_url: c.picture_path ? (links.get(c.picture_path) ?? null) : null,
      })),
    });
  }, [supabase]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    // New groups, members, roles, edits and messages (for unread counts). Realtime only
    // sends rows the database lets you see.
    const channel = supabase
      .channel(`dashboard-${me}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, me, load]);

  const value: DashboardGroups =
    state.status === "error"
      ? {
          status: "error",
          retry: () => {
            setState({ status: "loading" });
            load();
          },
        }
      : state;

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useDashboardGroups = () => useContext(Context);
