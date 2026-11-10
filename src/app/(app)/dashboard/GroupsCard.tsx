"use client";

import Link from "next/link";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import { ChevronRightIcon, PlusIcon, SearchIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { memberLabel, ROLE_LABEL } from "../group/types";
import { useDashboardGroups } from "./DashboardData";

// "Your groups" card: your real groups, the same as the Group page. Each opens that group.

export default function GroupsCard() {
  const state = useDashboardGroups();
  const { id: me } = useProfile();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = state.status === "ready" ? state.groups : [];
  const shown = groups.filter((g) => !q || (g.name ?? "").toLowerCase().includes(q));

  return (
    <section className="rounded-3xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1">
          <h2 className="text-xl font-extrabold text-ink">Your groups</h2>
          <p className="mt-0.5 text-sm text-muted">Shared tabs with friends, clubs and trips</p>
        </div>
        {groups.length > 0 && (
          <label className="flex h-11 max-w-[300px] flex-1 basis-[220px] items-center gap-2 rounded-xl border border-line bg-mist px-3.5">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
            <span className="sr-only">Search groups</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search groups"
              className="min-w-0 grow bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
        )}
        <Link
          href="/group?new=group"
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 font-bold text-white transition hover:bg-brand-hover"
        >
          <PlusIcon className="h-4 w-4" />
          Create Group
        </Link>
      </div>

      {state.status === "loading" && (
        <ul aria-hidden="true" className="mt-4 flex flex-col gap-2">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl p-2.5">
              <span className="h-12 w-12 animate-pulse rounded-2xl bg-mist" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3.5 w-1/3 animate-pulse rounded bg-mist" />
                <span className="h-3 w-1/4 animate-pulse rounded bg-mist" />
              </span>
            </li>
          ))}
        </ul>
      )}

      {state.status === "error" && (
        <div role="alert" className="mt-5 rounded-2xl bg-mist px-5 py-6 text-center">
          <p className="font-bold text-ink">Couldn&apos;t load your groups</p>
          <p className="mt-1 text-sm text-muted">Check your connection and try again.</p>
          <button
            type="button"
            onClick={state.retry}
            className="mt-3 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
          >
            Retry
          </button>
        </div>
      )}

      {state.status === "ready" && shown.length > 0 && (
        <ul className="mt-4 flex flex-col">
          {shown.map((g) => {
            const role = g.members.find((m) => m.user_id === me)?.role;
            return (
              <li key={g.id} className="border-b border-[#EEF1EA] last:border-b-0">
                <Link href={`/group?chat=${g.id}`} className="flex items-center gap-3.5 rounded-2xl px-2.5 py-3 hover:bg-mist">
                  <Avatar src={g.picture_url} name={g.name ?? "Group"} seed={g.id} size={48} shape="square" gradient={g.avatar_gradient} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold text-ink">{g.name}</span>
                    <span className="truncate text-[13px] text-muted">
                      {memberLabel(g.members.length)}
                      {role ? ` · ${ROLE_LABEL[role]}` : ""}
                      {g.description ? ` · ${g.description}` : ""}
                    </span>
                  </span>
                  {g.unread_mentions > 0 && (
                    <span className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">@ You</span>
                  )}
                  {g.unread_count > 0 && (
                    <span
                      aria-label={`${g.unread_count} unread ${g.unread_count === 1 ? "message" : "messages"}`}
                      className="flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-tint px-1.5 text-xs font-bold text-brand"
                    >
                      {g.unread_count > 99 ? "99+" : g.unread_count}
                    </span>
                  )}
                  <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {state.status === "ready" && shown.length === 0 && (
        <div className="mt-5 rounded-2xl bg-mist px-5 py-8 text-center">
          {q ? (
            <p className="text-muted">No groups match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <>
              <p className="font-bold text-ink">No groups yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                Create a group for your club, trip or apartment, then invite friends to start sharing costs.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
