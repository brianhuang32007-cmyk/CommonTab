"use client";

import Link from "next/link";
import { useState } from "react";
import { PlusIcon, SearchIcon } from "@/components/app/icons";

// "Your groups" card. Groups arrive in Step 6; until then it shows an empty state.
type GroupRow = { id: string; name: string };
const groups: GroupRow[] = [];

export default function GroupsCard() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = groups.filter((g) => !q || g.name.toLowerCase().includes(q));

  return (
    <section className="rounded-3xl border border-line bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[180px] flex-1">
          <h2 className="text-xl font-extrabold text-ink">Your groups</h2>
          <p className="mt-0.5 text-sm text-muted">Shared tabs with friends, clubs and trips</p>
        </div>
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
        <Link
          href="/group"
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 font-bold text-white transition hover:bg-brand-hover"
        >
          <PlusIcon className="h-4 w-4" />
          Create Group
        </Link>
      </div>

      {shown.length === 0 && (
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
