"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import {
  AddContactIcon,
  ChatIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  StarIcon,
  UserIcon,
} from "@/components/app/icons";
import { PaymentLogo, type PaymentProvider } from "@/components/app/PaymentLogos";
import { useProfile } from "@/components/app/ProfileContext";
import { formatUsPhone } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { useNow } from "@/lib/useNow";
import { fullName, type ContactRow, type Relation, type SearchRow } from "./types";

const VISIBLE_CONTACTS = 12; // rows that fit before the list scrolls

type Actions = {
  add: (id: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  star: (id: string, value: boolean) => Promise<void>;
};

export default function ContactsView({ initialRows, loadError }: { initialRows: ContactRow[]; loadError: boolean }) {
  const me = useProfile();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState(loadError ? "Couldn't load your contacts. Refresh the page to try again." : "");
  const [viewing, setViewing] = useState<string | null>(null);
  // Bumped after every change so open search results show the new status.
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const { data, error } = await createClient().rpc("my_contacts");
    if (!error && data) setRows(data as ContactRow[]);
    setVersion((v) => v + 1);
  }, []);

  // Live updates: when a row that includes me changes (someone adds, accepts or removes me), reload.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`contacts-page-${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 150);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [me.id, refresh]);

  const run = useCallback(
    async (call: PromiseLike<{ error: unknown }>, failMessage: string) => {
      setError("");
      const { error } = await call;
      if (error) setError(failMessage);
      await refresh();
    },
    [refresh],
  );

  const actions: Actions = {
    add: (id) => run(createClient().rpc("send_contact_request", { target: id }), "Couldn't send that request. Please try again."),
    accept: (id) => run(createClient().rpc("accept_contact_request", { other: id }), "Couldn't accept that request. Please try again."),
    remove: (id) => run(createClient().rpc("remove_contact", { other: id }), "That didn't work. Please try again."),
    star: (id, value) => {
      setRows((list) => list.map((r) => (r.user_id === id ? { ...r, starred: value } : r))); // show it right away
      return run(createClient().rpc("set_contact_star", { other: id, value }), "Couldn't update the star. Please try again.");
    },
  };

  const viewed = rows.find((r) => r.user_id === viewing && r.relation === "contact") ?? null;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-warn">
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <AddContactCard version={version} actions={actions} />

        {/* Right column on desktop; between the cards on phones */}
        <div className="flex flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <RequestsCard rows={rows} actions={actions} />
          <section className="rounded-[20px] border border-[#ECE6C8] bg-cream p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-butter-strong text-[#5C4A0B]">
                <LockIcon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <p className="font-bold text-ink">Who can find you</p>
                <p className="mt-0.5 text-[13px] text-[#3E4A43]">
                  Choose whether anyone can search @{me.username}, or only your contacts. Your birthday is never shown.
                </p>
                <Link href="/preferences#privacy" className="mt-2 inline-block text-sm font-bold text-brand hover:underline">
                  Change in Preferences
                </Link>
              </div>
            </div>
          </section>
        </div>

        <ContactsCard rows={rows} actions={actions} onView={(id) => setViewing(id)} />
      </div>

      <ProfileDialog
        person={viewed}
        onClose={() => setViewing(null)}
        onRemove={async (id) => {
          setViewing(null);
          await actions.remove(id);
        }}
      />
    </div>
  );
}

/* ---------- Add Contact: search by username ---------- */

function AddContactCard({ version, actions }: { version: number; actions: Actions }) {
  const [query, setQuery] = useState("");
  const q = query.trim().replace(/^@/, "").toLowerCase();
  // The last answer from the database, and which search (text + version) it was for.
  const [found, setFound] = useState<{ key: string; rows: SearchRow[]; failed: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const key = `${q}#${version}`;

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await createClient().rpc("search_profiles", { q });
      if (!cancelled) setFound({ key, rows: (data as SearchRow[] | null) ?? [], failed: Boolean(error) });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, key]);

  // Keep showing the previous results while a refresh for the same text loads.
  const current = found && found.key.startsWith(`${q}#`) ? found : null;
  const results = current?.rows ?? [];
  const total = results[0]?.total ?? 0;

  async function act(id: string, action: (id: string) => Promise<void>) {
    setBusy(id);
    await action(id);
    setBusy(null);
  }

  return (
    <section id="add-contact" aria-labelledby="add-title" className="scroll-mt-24 rounded-3xl border border-line bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
          <AddContactIcon className="h-5 w-5" />
        </span>
        <div>
          <h2 id="add-title" className="text-lg font-extrabold text-ink sm:text-xl">
            Add Contact
          </h2>
          <p className="text-sm text-muted">Find friends by their CommonTab username.</p>
        </div>
      </div>

      <label className="mt-4 flex h-[52px] items-center gap-2.5 rounded-[14px] border border-line bg-white px-4 focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/15">
        <SearchIcon className="h-[18px] w-[18px] shrink-0 text-muted" />
        <span className="sr-only">Search by username</span>
        <span className="font-semibold text-muted" aria-hidden="true">
          @
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={21}
          className="-ml-1.5 h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted/70 focus:outline-none"
        />
      </label>

      <div aria-live="polite">
        {q.length < 2 ? (
          <p className="mt-3 text-sm text-muted">Type at least 2 letters of their username.</p>
        ) : !current ? (
          <p className="mt-3 text-sm text-muted">Searching…</p>
        ) : current.failed ? (
          <p className="mt-3 text-sm text-warn">Search isn&apos;t working right now. Please try again.</p>
        ) : results.length === 0 ? (
          <p className="mt-3 rounded-2xl bg-mist p-4 text-center text-sm text-muted">
            No one found with “@{q}”. Check the spelling, or ask your friend for their username.
          </p>
        ) : (
          <>
            {/* 4 results fit; scroll for up to 10 */}
            <ul aria-label="Search results" className="mt-3 flex max-h-[280px] flex-col gap-2 overflow-y-auto pr-1">
              {results.map((p) => (
                <li key={p.id} className="flex h-16 shrink-0 items-center gap-3 rounded-2xl bg-mist px-3.5">
                  <Avatar src={p.avatar_url} name={fullName(p)} seed={p.id} size={42} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold text-ink">{fullName(p)}</span>
                    <span className="truncate text-[13px] text-muted">@{p.username}</span>
                  </span>
                  <SearchAction relation={p.relation} name={fullName(p)} busy={busy === p.id}
                    onAdd={() => act(p.id, actions.add)}
                    onCancel={() => act(p.id, actions.remove)}
                    onAccept={() => act(p.id, actions.accept)}
                  />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              {total > results.length
                ? `Showing the top ${results.length} of ${total} matches. Type more to narrow it down.`
                : `${total} ${total === 1 ? "match" : "matches"}`}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function SearchAction({
  relation,
  name,
  busy,
  onAdd,
  onCancel,
  onAccept,
}: {
  relation: Relation;
  name: string;
  busy: boolean;
  onAdd: () => void;
  onCancel: () => void;
  onAccept: () => void;
}) {
  if (relation === "contact") {
    return (
      <span className="flex h-9 items-center gap-1.5 rounded-full bg-tint px-3 text-sm font-bold text-brand">
        <CheckIcon className="h-4 w-4" />
        Contact
      </span>
    );
  }
  if (relation === "sent") {
    return (
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        aria-label={`Requested. Cancel request to ${name}`}
        className="flex h-11 items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 font-bold text-muted transition hover:bg-mist disabled:opacity-60"
      >
        <ClockIcon className="h-4 w-4" />
        Requested
      </button>
    );
  }
  if (relation === "received") {
    return (
      <button
        type="button"
        onClick={onAccept}
        disabled={busy}
        className="h-11 rounded-xl bg-brand px-4 font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
      >
        Accept
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={busy}
      className="flex h-11 items-center gap-1.5 rounded-xl bg-brand px-4 font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
    >
      <PlusIcon className="h-4 w-4" />
      Add
    </button>
  );
}

/* ---------- Your contacts ---------- */

function ContactsCard({ rows, actions, onView }: { rows: ContactRow[]; actions: Actions; onView: (id: string) => void }) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();

  // Starred first, then A to Z.
  const all = rows.filter((r) => r.relation === "contact");
  const shown = all
    .filter((r) => !f || fullName(r).toLowerCase().includes(f) || r.username.includes(f))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || fullName(a).localeCompare(fullName(b)));

  return (
    <section aria-labelledby="list-title" className="rounded-3xl border border-line bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2.5">
          <h2 id="list-title" className="text-lg font-extrabold text-ink sm:text-xl">
            Your contacts
          </h2>
          <span className="flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-tint px-2 text-[13px] font-bold text-brand">
            {all.length}
          </span>
        </div>
        {all.length > 0 && (
          <label className="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-mist px-3.5 focus-within:border-brand sm:w-64">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted" />
            <span className="sr-only">Filter contacts</span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter contacts"
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted/70 focus:outline-none"
            />
          </label>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-mist p-5 text-center text-sm text-muted">
          {all.length ? `No contacts match “${filter}”.` : "No contacts yet. Search for a username above to add your first one."}
        </p>
      ) : (
        <>
          {/* 12 rows fit; scroll for the rest */}
          <ul aria-label="Contacts" className="mt-4 max-h-[876px] overflow-y-auto pr-1">
            {shown.map((r) => {
              const name = fullName(r);
              return (
                <li key={r.user_id} className="flex h-[73px] items-center gap-3 border-t border-[#EEF1EA] px-1">
                  <Avatar src={r.avatar_url} name={name} seed={r.user_id} size={46} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold text-ink">{name}</span>
                    <span className="truncate text-[13px] text-muted">@{r.username}</span>
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconButton
                      label={r.starred ? `Unstar ${name}` : `Star ${name}`}
                      pressed={r.starred}
                      onClick={() => actions.star(r.user_id, !r.starred)}
                      className={r.starred ? "text-[#B7791F]" : "text-muted"}
                    >
                      <StarIcon className={`h-5 w-5 ${r.starred ? "fill-current" : ""}`} />
                    </IconButton>
                    <IconButton label={`View ${name}'s profile`} onClick={() => onView(r.user_id)} className="text-muted">
                      <UserIcon className="h-5 w-5" />
                    </IconButton>
                    <Link
                      href={`/group?dm=${encodeURIComponent(r.username)}`}
                      aria-label={`Message ${name}`}
                      title={`Message ${name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-xl text-brand transition hover:bg-tint"
                    >
                      <ChatIcon className="h-5 w-5" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length > VISIBLE_CONTACTS && (
            <p className="mt-2 text-xs text-muted">
              Showing {VISIBLE_CONTACTS} of {shown.length}. Scroll the list to see more.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- Requests ---------- */

function RequestsCard({ rows, actions }: { rows: ContactRow[]; actions: Actions }) {
  const [tab, setTab] = useState<"received" | "sent">("received");
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();
  const newestFirst = (a: ContactRow, b: ContactRow) => b.requested_at.localeCompare(a.requested_at);
  const received = rows.filter((r) => r.relation === "received").sort(newestFirst);
  const sent = rows.filter((r) => r.relation === "sent").sort(newestFirst);

  async function act(id: string, action: (id: string) => Promise<void>) {
    setBusy(id);
    await action(id);
    setBusy(null);
  }

  const tabClass = (on: boolean) =>
    `h-11 rounded-[10px] text-sm transition ${on ? "bg-white font-bold text-ink shadow-sm" : "font-semibold text-muted hover:text-ink"}`;

  return (
    <section aria-labelledby="req-title" className="rounded-3xl border border-line bg-white p-5 sm:p-6">
      <h2 id="req-title" className="text-lg font-extrabold text-ink sm:text-xl">
        Requests
      </h2>
      <div role="tablist" aria-label="Requests" className="mt-3.5 grid grid-cols-2 gap-1 rounded-[14px] bg-[#F1F3EC] p-1">
        <button type="button" role="tab" aria-selected={tab === "received"} onClick={() => setTab("received")} className={tabClass(tab === "received")}>
          Received · {received.length}
        </button>
        <button type="button" role="tab" aria-selected={tab === "sent"} onClick={() => setTab("sent")} className={tabClass(tab === "sent")}>
          Sent · {sent.length}
        </button>
      </div>

      {tab === "received" ? (
        received.length ? (
          <ul className="mt-3.5 flex max-h-[420px] flex-col gap-2.5 overflow-y-auto">
            {received.map((r) => (
              <li key={r.user_id} className="rounded-2xl bg-tint p-3.5">
                <div className="flex items-center gap-3">
                  <Avatar src={r.avatar_url} name={fullName(r)} seed={r.user_id} size={44} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-bold text-ink">{fullName(r)}</span>
                    <span className="truncate text-[13px] text-[#3E4A43]">
                      @{r.username}
                      {now && ` · ${timeAgo(r.requested_at, now)}`}
                    </span>
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy === r.user_id}
                    onClick={() => act(r.user_id, actions.accept)}
                    className="h-11 rounded-xl bg-brand font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.user_id}
                    onClick={() => act(r.user_id, actions.remove)}
                    className="h-11 rounded-xl border border-line bg-white font-bold text-ink transition hover:bg-mist disabled:opacity-60"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3.5 rounded-2xl bg-mist p-4 text-center text-sm text-muted">No new requests.</p>
        )
      ) : sent.length ? (
        <ul className="mt-3.5 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
          {sent.map((r) => (
            <li key={r.user_id} className="flex items-center gap-3 rounded-2xl bg-mist px-3.5 py-3">
              <Avatar src={r.avatar_url} name={fullName(r)} seed={r.user_id} size={40} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-bold text-ink">{fullName(r)}</span>
                <span className="truncate text-[13px] text-muted">
                  Waiting{now && ` · ${timeAgo(r.requested_at, now)}`}
                </span>
              </span>
              <button
                type="button"
                disabled={busy === r.user_id}
                onClick={() => act(r.user_id, actions.remove)}
                className="h-10 rounded-[10px] border border-line bg-white px-3.5 text-sm font-bold text-ink transition hover:bg-mist disabled:opacity-60"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3.5 rounded-2xl bg-mist p-4 text-center text-sm text-muted">You haven&apos;t sent any requests.</p>
      )}
    </section>
  );
}

/* ---------- Profile pop-up ---------- */

function ProfileDialog({
  person,
  onClose,
  onRemove,
}: {
  person: ContactRow | null;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (person && !dialog.open) dialog.showModal();
    if (!person && dialog.open) dialog.close();
  }, [person]);

  const handles: { key: PaymentProvider; label: string; value: string }[] = [];
  if (person) {
    if (person.venmo_username) handles.push({ key: "venmo", label: "Venmo", value: `@${person.venmo_username}` });
    if (person.paypal_username) handles.push({ key: "paypal", label: "PayPal", value: `paypal.me/${person.paypal_username}` });
    if (person.zelle_contact) handles.push({ key: "zelle", label: "Zelle", value: formatUsPhone(person.zelle_contact) });
    // Their "show first" handle leads.
    handles.sort((a, b) => Number(b.key === person.preferred_handle) - Number(a.key === person.preferred_handle));
  }
  const firstName = person?.first_name ?? "";

  return (
    <dialog
      ref={ref}
      aria-labelledby="profile-name"
      onClose={() => {
        setConfirming(false);
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close(); // click outside the card
      }}
      className="m-auto w-[calc(100%-32px)] max-w-md rounded-3xl bg-white p-0 text-ink shadow-xl backdrop:bg-night/40"
    >
      {person && (
        <div className="p-6">
          <div className="flex items-start gap-4">
            <Avatar src={person.avatar_url} name={fullName(person)} seed={person.user_id} size={64} />
            <div className="min-w-0 flex-1">
              <h2 id="profile-name" className="truncate text-xl font-extrabold">
                {fullName(person)}
              </h2>
              <p className="truncate text-sm text-muted">@{person.username}</p>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-mist"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 rounded-2xl bg-mist p-4">
            <p className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">Payment handles</p>
            {handles.length ? (
              <ul className="mt-2.5 flex flex-col gap-2 text-sm">
                {handles.map((h) => (
                  <li key={h.key} className="flex items-center gap-2.5">
                    <PaymentLogo provider={h.key} className="h-7 w-7" />
                    <span className="w-14 shrink-0 font-bold">{h.label}</span>
                    <span className="min-w-0 truncate text-[#3E4A43]">{h.value}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">{firstName} hasn&apos;t added any yet.</p>
            )}
            {person.phone && (
              <p className="mt-3 border-t border-line pt-3 text-sm">
                <span className="font-bold">Phone</span> <span className="text-[#3E4A43]">{formatUsPhone(person.phone)}</span>
              </p>
            )}
          </div>

          <div className="mt-3 rounded-2xl bg-mist p-4">
            <p className="text-[11px] font-bold tracking-[0.12em] text-muted uppercase">Groups in common</p>
            {/* Filled in once Groups is built (Step 6). Up to 2 show; more scroll. */}
            <p className="mt-2 text-sm text-muted">No groups in common yet.</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={`/group?dm=${encodeURIComponent(person.username)}`}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-hover"
            >
              <ChatIcon className="h-5 w-5" />
              Message
            </Link>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="h-12 rounded-xl px-4 font-semibold text-muted ring-1 ring-line hover:bg-mist"
              >
                Remove Contact
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onRemove(person.user_id)}
                className="h-12 rounded-xl bg-ink px-4 font-semibold text-white hover:bg-black"
              >
                Yes, Remove
              </button>
            )}
          </div>
          {confirming && (
            <p className="mt-2 text-[13px] text-muted">{firstName} won&apos;t be told. You can add them again later.</p>
          )}
        </div>
      )}
    </dialog>
  );
}

/* ---------- Small pieces ---------- */

function timeAgo(iso: string, now: Date) {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function IconButton({
  label,
  onClick,
  pressed,
  className = "",
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-mist ${className}`}
    >
      {children}
    </button>
  );
}
