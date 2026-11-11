"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { AddContactIcon, ChatIcon, CheckIcon, PlusIcon, SearchIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { groupPictureLinks } from "@/lib/groupPictures";
import { createClient } from "@/lib/supabase/client";
import type { ContactRow } from "../contacts/types";
import Conversation from "./Conversation";
import { DetailsDialog, EditGroupDialog, NewDmDialog, NewGroupDialog, type ContactsState, type GroupEdit, type NewGroup } from "./dialogs";
import SidePanel from "./SidePanel";
import { personName, titleOf, type Conversation as Chat } from "./types";

// Group page: chat list | conversation | side panel, on real Supabase data.
// Wide screens show all three columns; tablets hide the side panel; phones show
// the list or one conversation at a time.

type Filter = "groups" | "dms";
type ListState = { status: "loading" } | { status: "error" } | { status: "ready"; chats: Chat[] };

export default function GroupView() {
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);

  const [list, setList] = useState<ListState>({ status: "loading" });
  const [contacts, setContacts] = useState<ContactsState>({ status: "loading" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("groups");
  const [search, setSearch] = useState("");
  const [phoneShowsChat, setPhoneShowsChat] = useState(false);
  const [dialog, setDialog] = useState<null | "group" | "dm" | "details" | "invite" | "edit">(null);
  const [toast, setToast] = useState<string | null>(null);

  // Success messages disappear after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  /* ---------- Loading + live updates ---------- */

  const load = useCallback(async () => {
    const [chats, people] = await Promise.all([supabase.rpc("my_conversations"), supabase.rpc("my_contacts")]);
    if (chats.error?.code === "PGRST202") {
      // The groups migration hasn't been run in Supabase yet, so there's nothing to show.
      if (process.env.NODE_ENV === "development") {
        console.warn("Group page: run supabase/migrations/20261110030000_groups.sql in the Supabase SQL Editor.");
      }
      setList({ status: "ready", chats: [] });
    } else if (chats.error) {
      // Keep what's on screen if a background refresh fails; only show the error at first.
      setList((current) => (current.status === "ready" ? current : { status: "error" }));
    } else {
      // Group pictures are private: swap each stored path for a short-lived link.
      const rows = (chats.data ?? []) as Omit<Chat, "picture_url">[];
      const links = await groupPictureLinks(
        supabase,
        rows.map((c) => c.picture_path),
      );
      setList({
        status: "ready",
        chats: rows.map((c) => ({
          ...c,
          unread_mentions: c.unread_mentions ?? 0,
          unread_count: c.unread_count ?? 0,
          picture_url: c.picture_path ? (links.get(c.picture_path) ?? null) : null,
        })),
      });
    }
    if (people.error) {
      // Keep the list if a background refresh fails; only show the error when there's nothing yet.
      setContacts((current) => (current.status === "ready" ? current : { status: "error" }));
    } else {
      setContacts({
        status: "ready",
        list: ((people.data ?? []) as ContactRow[])
          .filter((p) => p.relation === "contact")
          .sort((a, b) => personName(a).localeCompare(personName(b))),
      });
    }
  }, [supabase]);

  const retryContacts = () => {
    setContacts({ status: "loading" });
    load();
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(load, 0);
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 150);
    };
    // Being added to a group or DM, role and picture changes, new contacts, new messages (for "@ You").
    // Realtime only sends rows the database lets this person see.
    const channel = supabase
      .channel(`group-page-${me}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, me, load]);

  // A link like /group?chat=<id> (e.g. from an alert) opens that chat, then the address is tidied up.
  const router = useRouter();
  // /group?new=group (the dashboard's Create Group) opens the New Group form.
  const params = useSearchParams();
  const linked = params.get("chat") ?? (params.get("new") === "group" ? "new-group" : null);
  const [handledLink, setHandledLink] = useState<string | null>(null);
  if (!linked && handledLink) setHandledLink(null);
  if (linked === "new-group" && linked !== handledLink) {
    setHandledLink(linked);
    setDialog("group");
  } else if (linked && linked !== handledLink && list.status === "ready") {
    setHandledLink(linked);
    const target = list.chats.find((c) => c.id === linked);
    if (target) {
      setActiveId(target.id);
      setFilter(target.kind === "group" ? "groups" : "dms");
      setPhoneShowsChat(true);
    }
  }
  useEffect(() => {
    if (linked && linked === handledLink) router.replace("/group", { scroll: false });
  }, [linked, handledLink, router]);

  // /group?dm=<person's id> (the Message icon on Contacts): opens your DM with them, or starts one.
  const dmWith = params.get("dm");
  const handledDm = useRef<string | null>(null);
  useEffect(() => {
    if (!dmWith || handledDm.current === dmWith || list.status !== "ready") return;
    handledDm.current = dmWith;
    const existing = list.chats.find((c) => c.kind === "dm" && c.members.some((m) => m.user_id === dmWith));
    // Handled once (the chat list refreshes often), so the timer isn't cleared on re-runs.
    setTimeout(async () => {
      if (existing) open(existing.id, "dm");
      else {
        const problem = await startDm(dmWith);
        if (problem) setToast(problem);
      }
      router.replace("/group", { scroll: false });
    }, 0);
    // open and startDm are plain functions recreated each render; the link is handled once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmWith, list, router]);

  const chats = list.status === "ready" ? list.chats : [];
  const active =
    chats.find((c) => c.id === activeId) ?? chats.find((c) => c.kind === (filter === "groups" ? "group" : "dm")) ?? chats[0] ?? null;
  const groups = chats.filter((c) => c.kind === "group");

  function open(id: string, kind?: Chat["kind"]) {
    setActiveId(id);
    setDialog(null);
    setPhoneShowsChat(true);
    const k = kind ?? chats.find((c) => c.id === id)?.kind;
    if (k) setFilter(k === "group" ? "groups" : "dms");
  }

  /* ---------- Actions (each resolves with an error message, or null) ---------- */

  // Group pictures live in group-pictures/<group id>/. Resolves with the file's path, or null.
  async function uploadPicture(groupId: string, file: File): Promise<string | null> {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${groupId}/${Date.now()}.${ext}`;
    const upload = await supabase.storage.from("group-pictures").upload(path, file, { contentType: file.type });
    return upload.error ? null : path;
  }

  async function createGroup(g: NewGroup): Promise<string | null> {
    // The request id makes this safe to send again: a retry returns the group already made.
    const { data: id, error } = await supabase.rpc("create_group", {
      group_name: g.name,
      group_description: g.description,
      member_ids: g.inviteIds,
      organizer_ids: g.organizerIds,
      gradient: g.gradient,
      client_request: g.requestId,
    });
    if (error || !id) return error?.message ?? "Couldn't create the group. Check your connection and try again.";

    let pictureProblem = false;
    if (g.picture) {
      const path = await uploadPicture(id as string, g.picture);
      const saved = path ? await supabase.rpc("set_group_picture", { target: id, path }) : null;
      pictureProblem = !path || Boolean(saved?.error);
    }

    await load();
    open(id as string, "group");
    setToast(pictureProblem ? `“${g.name}” was created, but its picture couldn't be uploaded.` : `“${g.name}” was created.`);
    return null;
  }

  async function startDm(userId: string): Promise<string | null> {
    const { data: id, error } = await supabase.rpc("start_dm", {
      other: userId,
    });
    if (error || !id) return error?.message ?? "Couldn't open that conversation. Try again.";
    await load();
    open(id as string, "dm");
    return null;
  }

  // Invited contacts join right away. Sending again is safe (people already in the group are skipped).
  async function invite(ids: string[], organizerIds: string[]): Promise<string | null> {
    if (!active) return null;
    const { error } = await supabase.rpc("add_group_members", {
      target: active.id,
      member_ids: ids,
      organizer_ids: organizerIds,
    });
    if (error) return error.message;
    await load();
    return null;
  }

  // Owner / organizer actions from the Details window. The database checks who may do what.
  async function groupAction(fn: string, args: Record<string, unknown>, done?: string): Promise<string | null> {
    if (!active) return null;
    const { error } = await supabase.rpc(fn, { target: active.id, ...args });
    if (error) return error.message;
    await load();
    if (done) setToast(done);
    return null;
  }
  const nameIn = (userId: string) => {
    const m = active?.members.find((x) => x.user_id === userId);
    return m ? personName(m) : "They";
  };
  const setRole = (userId: string, role: "member" | "organizer") =>
    groupAction(
      "set_member_role",
      { member: userId, new_role: role },
      `${nameIn(userId)} is now ${role === "organizer" ? "an organizer" : "a member"}.`,
    );
  const removeMember = (userId: string) =>
    groupAction("remove_group_member", { member: userId }, `${nameIn(userId)} was removed from the group.`);
  const transferOwnership = (userId: string) =>
    groupAction("transfer_group_ownership", { new_owner: userId }, `${nameIn(userId)} is now the owner.`);

  // Owner only. Picture files go first, while the owner can still reach them.
  async function deleteGroup(): Promise<string | null> {
    if (!active || active.kind !== "group") return null;
    const { id, name } = active;
    const files = await supabase.storage.from("group-pictures").list(id);
    if (files.data?.length) {
      await supabase.storage.from("group-pictures").remove(files.data.map((f) => `${id}/${f.name}`));
    }
    const { error } = await supabase.rpc("delete_group", { target: id });
    if (error) return error.message;
    setDialog(null);
    setActiveId(null);
    await load();
    setToast(`“${name}” was deleted.`);
    return null;
  }

  // Owner and organizers. A new picture is uploaded first; then name, description and picture
  // save in one update, which reaches the other members live. Old picture files are cleaned up after.
  async function saveGroup(edit: GroupEdit): Promise<string | null> {
    if (!active || active.kind !== "group") return null;
    const id = active.id;
    let path: string | null = null;
    if (edit.picture instanceof File) {
      path = await uploadPicture(id, edit.picture);
      if (!path) return "Couldn't upload the picture. Check your connection and try again.";
    }
    const { error } = await supabase.rpc("update_group", {
      target: id,
      group_name: edit.name,
      group_description: edit.description,
      picture: path,
      change_picture: edit.picture !== "keep",
    });
    if (error) return error.message;

    if (edit.picture !== "keep") {
      const files = await supabase.storage.from("group-pictures").list(id);
      const old = (files.data ?? []).map((f) => `${id}/${f.name}`).filter((p) => p !== path);
      if (old.length) await supabase.storage.from("group-pictures").remove(old);
    }
    setDialog(null);
    await load();
    setToast("Group changes saved.");
    return null;
  }

  /* ---------- Layout ---------- */

  return (
    <>
      <div className="flex h-[calc(100dvh-208px)] min-h-[460px] gap-4 lg:h-[calc(100dvh-160px)]">
        <ChatList
          list={list}
          activeId={active?.id ?? null}
          me={me}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          onOpen={(id) => open(id)}
          onRetry={() => {
            setList({ status: "loading" });
            load();
          }}
          onNewGroup={() => setDialog("group")}
          onNewDm={() => setDialog("dm")}
          className={`${phoneShowsChat ? "hidden md:flex" : "flex"} w-full md:w-[260px] md:shrink-0 xl:w-[300px]`}
        />

        {active ? (
          <Conversation
            key={active.id}
            supabase={supabase}
            chat={active}
            me={me}
            onRead={load}
            onBack={() => setPhoneShowsChat(false)}
            onDetails={() => setDialog("details")}
            className={`${phoneShowsChat ? "flex" : "hidden md:flex"} min-w-0 flex-1 min-[1440px]:w-[534px] min-[1440px]:flex-none`}
          />
        ) : (
          <section className="hidden min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-3xl border border-line bg-white px-6 text-center md:flex min-[1440px]:w-[534px] min-[1440px]:flex-none">
            {/* Shown whenever no chat is open, so the center is never blank. */}
            <>
              <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
                <ChatIcon className="h-7 w-7" />
              </span>
              <p className="text-lg font-extrabold">No groups yet</p>
              <p className="mt-1.5 max-w-xs text-sm text-muted">Select a group to see it here, or start one below.</p>
              <div className="mt-5 flex w-full max-w-[260px] flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => setDialog("group")}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover"
                >
                  <PlusIcon className="h-5 w-5" />
                  Make New Group
                </button>
                <button
                  type="button"
                  onClick={() => setDialog("dm")}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist"
                >
                  <ChatIcon className="h-5 w-5" />
                  Make New DM
                </button>
                <Link
                  href="/contacts"
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist"
                >
                  <AddContactIcon className="h-5 w-5" />
                  Discover Contacts
                </Link>
              </div>
            </>
          </section>
        )}

        <SidePanel
          chat={active}
          me={me}
          groups={groups}
          onDetails={() => setDialog("details")}
          onOpen={(id) => open(id, "group")}
          className="hidden min-w-[220px] flex-1 min-[1440px]:flex"
        />
      </div>

      {/* Success message */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-2xl bg-ink px-4 py-3 text-sm font-bold text-white shadow-xl shadow-night/20"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand">
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
            {toast}
          </p>
        )}
      </div>

      <NewGroupDialog
        open={dialog === "group"}
        contacts={contacts}
        onRetryContacts={retryContacts}
        onClose={() => setDialog(null)}
        onCreate={createGroup}
      />
      <NewDmDialog
        open={dialog === "dm"}
        contacts={contacts}
        onRetryContacts={retryContacts}
        onClose={() => setDialog(null)}
        onPick={startDm}
      />
      <DetailsDialog
        group={(dialog === "details" || dialog === "invite") && active?.kind === "group" ? active : null}
        mode={dialog === "invite" ? "invite" : "details"}
        me={me}
        contacts={contacts}
        onRetryContacts={retryContacts}
        onMode={(mode) => setDialog(mode)}
        onClose={() => setDialog(null)}
        onInvite={invite}
        onSetRole={setRole}
        onRemove={removeMember}
        onTransfer={transferOwnership}
        onDelete={deleteGroup}
        onEdit={() => setDialog("edit")}
      />
      <EditGroupDialog
        group={dialog === "edit" && active?.kind === "group" ? active : null}
        onCancel={() => setDialog("details")}
        onSave={saveGroup}
      />
    </>
  );
}

/* ---------- Chat list (left column) ---------- */

function ChatList({
  list,
  activeId,
  me,
  filter,
  onFilter,
  search,
  onSearch,
  onOpen,
  onRetry,
  onNewGroup,
  onNewDm,
  className,
}: {
  list: ListState;
  activeId: string | null;
  me: string;
  filter: Filter;
  onFilter: (f: Filter) => void;
  search: string;
  onSearch: (q: string) => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onNewGroup: () => void;
  onNewDm: () => void;
  className: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close the + menu on a click outside or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const q = search.trim().toLowerCase().replace(/^@/, "");
  const chats = list.status === "ready" ? list.chats : [];
  const shown = chats.filter(
    (c) =>
      (filter === "groups") === (c.kind === "group") &&
      (!q ||
        titleOf(c, me).toLowerCase().includes(q) ||
        (c.kind === "dm" && c.members.some((m) => m.user_id !== me && m.username.includes(q)))),
  );
  const now = new Date();

  return (
    <section aria-labelledby="chats-title" className={`min-h-0 flex-col rounded-3xl border border-line bg-white ${className}`}>
      <div className="shrink-0 px-[18px] pt-5">
        <div ref={menu} className="relative flex items-center justify-between">
          <h2 id="chats-title" className="text-xl font-extrabold">
            Chats
          </h2>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="New group or DM"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white hover:bg-brand-hover"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full right-0 z-20 mt-2 w-56 rounded-2xl border border-line bg-white p-1.5 shadow-xl shadow-night/10"
            >
              <MenuItem
                icon={<AddContactIcon className="h-[18px] w-[18px]" />}
                label="New group"
                onClick={() => {
                  setMenuOpen(false);
                  onNewGroup();
                }}
              />
              <MenuItem
                icon={<ChatIcon className="h-[18px] w-[18px]" />}
                label="New DM"
                onClick={() => {
                  setMenuOpen(false);
                  onNewDm();
                }}
              />
            </div>
          )}
        </div>

        <label className="mt-3.5 flex h-11 items-center gap-2 rounded-xl border border-line bg-mist px-3.5">
          <SearchIcon className="h-4 w-4 text-muted" />
          <span className="sr-only">Search chats</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>

        <div role="tablist" aria-label="Show" className="mt-3 flex gap-1.5">
          {(
            [
              ["groups", "Groups"],
              ["dms", "DMs"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              onClick={() => onFilter(key)}
              className={`h-9 flex-1 rounded-full border text-sm ${
                filter === key
                  ? "border-brand bg-tint font-bold text-brand"
                  : "border-line bg-white font-semibold text-[#3E4A43] hover:bg-mist"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        {list.status === "loading" &&
          [0, 1, 2].map((i) => (
            <li key={i} aria-hidden="true" className="flex items-center gap-3 p-2.5">
              <span className="h-[46px] w-[46px] shrink-0 animate-pulse rounded-full bg-mist" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="h-3.5 w-2/3 animate-pulse rounded bg-mist" />
                <span className="h-3 w-full animate-pulse rounded bg-mist" />
              </span>
            </li>
          ))}

        {list.status === "error" && (
          <li className="mx-1.5 mt-2 rounded-2xl bg-mist p-4 text-center">
            <p className="text-sm font-bold">Couldn&apos;t load your chats</p>
            <p className="mt-1 text-[13px] text-muted">Check your connection and try again.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 h-10 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
            >
              Retry
            </button>
          </li>
        )}

        {shown.map((c) => {
          const on = c.id === activeId;
          const name = titleOf(c, me);
          const other = c.kind === "dm" ? c.members.find((m) => m.user_id !== me) : undefined;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                aria-current={on ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left ${on ? "bg-tint" : "hover:bg-mist"}`}
              >
                <Avatar
                  src={c.kind === "group" ? c.picture_url : other?.avatar_url}
                  name={name}
                  seed={c.kind === "group" ? c.id : (other?.user_id ?? c.id)}
                  size={46}
                  shape={c.kind === "group" ? "square" : "circle"}
                  gradient={c.kind === "group" ? c.avatar_gradient : null}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{name}</span>
                    {c.unread_mentions > 0 && (
                      // Someone mentioned you here in a message you haven't read yet.
                      <span
                        aria-label={`${c.unread_mentions} unread ${c.unread_mentions === 1 ? "mention" : "mentions"} of you`}
                        className="shrink-0 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white"
                      >
                        @ You
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                      {c.kind === "group"
                        ? `${c.members.length} ${c.members.length === 1 ? "member" : "members"}`
                        : `@${other?.username ?? "deleted"}`}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">{listTime(c.created_at, now)}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}

        {list.status === "ready" && !shown.length && (
          <li className="mx-1.5 mt-2 rounded-2xl bg-mist p-4 text-center text-sm text-muted">
            {q ? `No chats match “${search.trim()}”.` : filter === "groups" ? "No groups yet" : "No DMs yet"}
          </li>
        )}
      </ul>
    </section>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex h-12 w-full items-center gap-3 rounded-[10px] px-3 text-left text-[15px] font-bold hover:bg-mist"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-tint text-brand">{icon}</span>
      {label}
    </button>
  );
}

/** "3:21 PM" today, "Yesterday", "Mon" this week, then "Nov 3". */
function listTime(iso: string, now: Date) {
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now))
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
