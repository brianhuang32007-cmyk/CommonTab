"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import Avatar, { GROUP_GRADIENTS } from "@/components/Avatar";
import { AddContactIcon, CheckIcon, ChevronLeftIcon, CloseIcon, PenIcon, PlusIcon, SearchIcon } from "@/components/app/icons";
import type { ContactRow } from "../contacts/types";
import { personName, ROLE_LABEL, type Conversation, type Role } from "./types";

const PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PICTURE_MAX = 2 * 1024 * 1024;

/** Your contacts, as the Group page loaded them. */
export type ContactsState = { status: "loading" } | { status: "error" } | { status: "ready"; list: ContactRow[] };

/* ---------- Shared pop-up frame ---------- */
//   • Opens with focus on the field marked data-autofocus (else the first control).
//   • With unsaved changes (dirty), every way of closing asks: keep editing, or discard.
//   • While something is saving (busy), it can't be closed, so nothing is half-sent.

type ModalApi = { requestClose: (then?: () => void) => void };
const ModalContext = createContext<ModalApi | null>(null);
function useModal() {
  const api = useContext(ModalContext);
  if (!api) throw new Error("useModal must be used inside a Modal");
  return api;
}

function Modal({
  onClose,
  labelledBy,
  className = "max-w-lg",
  dirty = false,
  busy = false,
  children,
}: {
  onClose: () => void;
  labelledBy: string;
  className?: string;
  dirty?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  // What to do if the person confirms "Discard" (null = not asking).
  const [discarding, setDiscarding] = useState<null | (() => void)>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const promptTitle = useId();

  // Each pop-up is only mounted while it's open, so it opens when it mounts.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  useEffect(() => {
    if (discarding) keepButton.current?.focus();
  }, [discarding]);

  function requestClose(then: () => void = onClose) {
    if (busy) return;
    if (dirty) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setDiscarding(() => then);
    } else then();
  }
  function keepEditing() {
    setDiscarding(null);
    returnFocus.current?.focus();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-busy={busy}
      onCancel={(e) => {
        // Esc: ask instead of closing straight away.
        e.preventDefault();
        if (discarding) keepEditing();
        else requestClose();
      }}
      onClose={() => {
        // The browser closed it anyway (e.g. Esc pressed twice quickly). Reopen and ask, or close.
        if ((dirty || busy) && ref.current) {
          ref.current.showModal();
          if (dirty && !busy) setDiscarding(() => onClose);
        } else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !discarding) requestClose(); // click outside the card
      }}
      className={`m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] overflow-hidden rounded-3xl bg-white p-0 text-ink shadow-xl backdrop:bg-night/40 ${className}`}
    >
      <ModalContext.Provider value={{ requestClose }}>
        <div className="relative flex max-h-[calc(100dvh-32px)] flex-col">
          {children}
          {discarding && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 p-6">
              <div
                role="alertdialog"
                aria-labelledby={promptTitle}
                className="w-full max-w-[360px] rounded-2xl border border-line bg-white p-5 shadow-xl shadow-night/10"
              >
                <p id={promptTitle} className="text-lg font-extrabold">
                  Discard your changes?
                </p>
                <p className="mt-1 text-sm text-muted">What you&apos;ve entered here won&apos;t be saved.</p>
                <div className="mt-4 flex gap-2">
                  <button ref={keepButton} type="button" onClick={keepEditing} className={`flex-1 px-3 whitespace-nowrap ${primaryButton}`}>
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const then = discarding;
                      setDiscarding(null);
                      then();
                    }}
                    className={`flex-1 px-3 whitespace-nowrap ${secondaryButton}`}
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ModalContext.Provider>
    </dialog>
  );
}

function DialogHeader({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between px-6 pt-5">
      <h2 id={id} className="text-[22px] font-extrabold">
        {title}
      </h2>
      <CloseButton />
    </div>
  );
}

function CloseButton() {
  const { requestClose } = useModal();
  return (
    <button
      type="button"
      onClick={() => requestClose()}
      aria-label="Close"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-mist"
    >
      <CloseIcon className="h-5 w-5" />
    </button>
  );
}

/** A contact row with a checkbox for picking who to invite. Once picked, a Member / Organizer
 *  switch appears (when choosing a role is allowed). */
function PickRow({
  person,
  role,
  onToggle,
  onRole,
}: {
  person: ContactRow;
  /** undefined = not picked */
  role: Role | undefined;
  onToggle: () => void;
  onRole?: (role: Role) => void;
}) {
  const checked = role !== undefined;
  const name = personName(person);
  return (
    <li className={`flex items-center gap-2 rounded-xl pr-2 ${checked ? "bg-mist" : "hover:bg-mist"}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`Invite ${name}`}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left"
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] ${
            checked ? "bg-brand text-white" : "border-2 border-[#C9D0C6] bg-white"
          }`}
        >
          {checked && <CheckIcon className="h-3.5 w-3.5 [&_path]:stroke-[3]" />}
        </span>
        <Avatar src={person.avatar_url} name={name} seed={person.user_id} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-bold">{name}</span>
          <span className="truncate text-[13px] text-muted">@{person.username}</span>
        </span>
      </button>
      {checked && onRole && <RoleSwitch name={name} role={role} onRole={onRole} />}
    </li>
  );
}

/** Member / Organizer switch. Arrow keys move between the two, like radio buttons. */
function RoleSwitch({ name, role, onRole }: { name: string; role: Role; onRole: (role: Role) => void }) {
  const choices = ["member", "organizer"] as const;
  return (
    <span role="radiogroup" aria-label={`Role for ${name}`} className="flex shrink-0 rounded-[10px] border border-line bg-white p-0.5">
      {choices.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={role === r}
          tabIndex={role === r ? 0 : -1}
          onClick={() => onRole(r)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const next = r === "member" ? "organizer" : "member";
            onRole(next);
            (e.currentTarget.parentElement?.querySelector(`[data-role="${next}"]`) as HTMLElement | null)?.focus();
          }}
          data-role={r}
          className={`h-8 rounded-lg px-2.5 text-xs font-bold ${role === r ? "bg-tint text-brand" : "text-muted hover:text-ink"}`}
        >
          {ROLE_LABEL[r]}
        </button>
      ))}
    </span>
  );
}

function NoContacts({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-mist p-4 text-center text-sm text-muted">
      <p>{text}</p>
      <Link
        href="/contacts"
        className="mt-3 flex h-11 items-center gap-2 rounded-xl bg-brand px-4 font-bold text-white hover:bg-brand-hover"
      >
        <AddContactIcon className="h-[18px] w-[18px]" />
        Find New Contacts
      </Link>
    </div>
  );
}

/** Contacts still loading, or they failed to load. Renders nothing once they're ready. */
function ContactsNotReady({ state, onRetry }: { state: ContactsState; onRetry: () => void }) {
  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 rounded-2xl bg-mist p-4 text-sm text-muted">
        <Spinner />
        Loading your contacts…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div role="alert" className="rounded-2xl bg-mist p-4 text-center">
        <p className="text-sm font-bold">Couldn&apos;t load your contacts</p>
        <p className="mt-1 text-[13px] text-muted">Check your connection and try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
        >
          Retry
        </button>
      </div>
    );
  }
  return null;
}

function SearchBox({
  value,
  onChange,
  label,
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  /** Focus this box when the pop-up opens. */
  autoFocus?: boolean;
}) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-mist px-3.5">
      <SearchIcon className="h-4 w-4 text-muted" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        data-autofocus={autoFocus || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
    </label>
  );
}

const matches = (p: ContactRow, search: string) => {
  const q = search.trim().toLowerCase().replace(/^@/, "");
  return !q || personName(p).toLowerCase().includes(q) || p.username.includes(q);
};

function ErrorText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm font-semibold text-warn">
      {text}
    </p>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

const primaryButton =
  "h-12 rounded-xl bg-brand px-5 font-bold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-muted";
const secondaryButton = "h-12 rounded-xl border border-line bg-white px-5 font-bold text-ink hover:bg-mist disabled:opacity-60";

type Picked = Record<string, Role>;
/** Pick (as a member) or un-pick someone. */
const toggle = (picked: Picked, id: string): Picked => {
  const next = { ...picked };
  if (next[id]) delete next[id];
  else next[id] = "member";
  return next;
};
const idsWith = (picked: Picked, role?: Role) => Object.keys(picked).filter((id) => !role || picked[id] === role);

/* ---------- Picture, name and description (shared by New Group and Edit Group) ---------- */

function GroupFields({
  name,
  onName,
  description,
  onDescription,
  preview,
  gradient,
  onPicture,
  onError,
  nameMissing,
  nameInput,
  nameError,
}: {
  name: string;
  onName: (value: string) => void;
  description: string;
  onDescription: (value: string) => void;
  /** What the picture shows now: a new file's preview, the saved picture, or null for the color. */
  preview: string | null;
  gradient: number;
  /** A checked file, or null to remove the picture. */
  onPicture: (file: File | null) => void;
  onError: (message: string | null) => void;
  nameMissing: boolean;
  nameInput: React.RefObject<HTMLInputElement | null>;
  nameError: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const ids = useId();

  return (
    <>
      <div className="flex items-center gap-4">
        {preview || trimmed ? (
          <Avatar src={preview} name={trimmed} size={72} shape="square" gradient={gradient} />
        ) : (
          // No name yet: just the group's color.
          <span
            aria-hidden="true"
            className="h-[72px] w-[72px] shrink-0 rounded-[20px]"
            style={{ background: `linear-gradient(135deg, ${GROUP_GRADIENTS[gradient][0]}, ${GROUP_GRADIENTS[gradient][1]})` }}
          />
        )}
        <div>
          <input
            ref={fileInput}
            type="file"
            accept={PICTURE_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!PICTURE_TYPES.includes(file.type)) return onError("Pictures must be JPG, PNG or WebP.");
              if (file.size > PICTURE_MAX) return onError("Pictures must be 2 MB or smaller.");
              onPicture(file);
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              aria-describedby={`${ids}-picture-help`}
              className="h-11 rounded-[10px] border border-line bg-white px-3.5 text-sm font-bold hover:bg-mist"
            >
              {preview ? "Change Picture" : "Add Picture"}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => onPicture(null)}
                aria-label="Remove picture"
                className="h-11 rounded-[10px] px-3 text-sm font-bold text-muted hover:bg-mist"
              >
                Remove
              </button>
            )}
          </div>
          <p id={`${ids}-picture-help`} className="mt-1.5 text-xs text-muted">
            Optional. JPG, PNG or WebP up to 2 MB. Without one, the group gets its initials on this color.
          </p>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">
          Group name <span className="text-warn">*</span>
        </span>
        <input
          ref={nameInput}
          data-autofocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={40}
          required
          placeholder="e.g. Tahoe Cabin Trip"
          aria-invalid={nameMissing}
          aria-describedby={nameMissing ? `${ids}-name-error` : undefined}
          className={`h-12 rounded-xl border bg-white px-3.5 text-base outline-none placeholder:text-muted focus:ring-3 ${
            nameMissing ? "border-warn focus:ring-warn/15" : "border-line focus:border-brand focus:ring-brand/15"
          }`}
        />
        {nameMissing && (
          <span id={`${ids}-name-error`} className="text-sm font-semibold text-warn">
            {nameError}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex justify-between text-sm font-bold">
          Description <span className="font-medium text-muted">{description.length}/200</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => onDescription(e.target.value.slice(0, 200))}
          rows={2}
          placeholder="What's this group for?"
          className="resize-none rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] outline-none placeholder:text-muted focus:border-brand focus:ring-3 focus:ring-brand/15"
        />
      </label>
    </>
  );
}

/** Frees a picked file's preview link when it's replaced or the form closes. */
function useBlobCleanup(preview: string | null) {
  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);
}

/* ---------- New group ---------- */

export type NewGroup = {
  name: string;
  description: string;
  picture: File | null;
  /** Which color gradient the group shows when it has no picture. */
  gradient: number;
  inviteIds: string[];
  organizerIds: string[];
  /** Same id for every try from one form, so a retry can't make a second group. */
  requestId: string;
};

const randomGradient = () => Math.floor(Math.random() * GROUP_GRADIENTS.length);

export function NewGroupDialog(props: {
  open: boolean;
  contacts: ContactsState;
  onRetryContacts: () => void;
  onClose: () => void;
  /** Resolves with an error message, or null when the group was created. */
  onCreate: (group: NewGroup) => Promise<string | null>;
}) {
  // Mounted only while open, so every New Group form starts empty.
  return props.open ? <NewGroupForm {...props} /> : null;
}

function NewGroupForm({
  contacts,
  onRetryContacts,
  onClose,
  onCreate,
}: {
  contacts: ContactsState;
  onRetryContacts: () => void;
  onClose: () => void;
  onCreate: (group: NewGroup) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picture, setPicture] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [gradient] = useState(randomGradient);
  const [requestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useBlobCleanup(preview);

  const trimmed = name.trim();
  const dirty = Boolean(trimmed || description.trim() || picture || idsWith(picked).length);
  const list = contacts.status === "ready" ? contacts.list : [];
  const shown = list.filter((p) => matches(p, search));

  return (
    <Modal onClose={onClose} labelledBy="new-group-title" className="max-w-[540px]" dirty={dirty} busy={busy}>
      <DialogHeader id="new-group-title" title="New Group" />
      <form
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!trimmed) {
            setNameMissing(true);
            nameInput.current?.focus();
            return;
          }
          setBusy(true);
          setError(null);
          const problem = await onCreate({
            name: trimmed,
            description: description.trim(),
            picture,
            gradient,
            inviteIds: idsWith(picked),
            organizerIds: idsWith(picked, "organizer"),
            requestId,
          });
          // On success the page closes this form. On an error everything entered stays.
          if (problem) {
            setError(problem);
            setBusy(false);
          }
        }}
      >
        {/* Everything is locked while the group is being created, so it can't be sent twice. */}
        <fieldset disabled={busy} className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4 disabled:opacity-70">
          <GroupFields
            name={name}
            onName={(v) => {
              setName(v);
              if (v.trim()) setNameMissing(false);
            }}
            description={description}
            onDescription={setDescription}
            preview={preview}
            gradient={gradient}
            onPicture={(file) => {
              setError(null);
              setPicture(file);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            onError={setError}
            nameMissing={nameMissing}
            nameInput={nameInput}
            nameError="Add a group name to create the group."
          />

          <div>
            <p className="flex justify-between text-sm font-bold">
              Invite contacts <span className="font-medium text-muted">{idsWith(picked).length} selected</span>
            </p>
            <div className="mt-2">
              {contacts.status !== "ready" ? (
                <ContactsNotReady state={contacts} onRetry={onRetryContacts} />
              ) : list.length ? (
                <>
                  <SearchBox value={search} onChange={setSearch} label="Search your contacts" />
                  <ul className="mt-2 flex max-h-[236px] flex-col gap-0.5 overflow-y-auto">
                    {shown.map((p) => (
                      <PickRow
                        key={p.user_id}
                        person={p}
                        role={picked[p.user_id]}
                        onToggle={() => setPicked((l) => toggle(l, p.user_id))}
                        onRole={(r) => setPicked((l) => ({ ...l, [p.user_id]: r }))}
                      />
                    ))}
                    {!shown.length && <li className="px-2.5 py-3 text-sm text-muted">No contacts match “{search.trim()}”.</li>}
                  </ul>
                </>
              ) : (
                <NoContacts text="You don't have any contacts yet. You can still create the group and invite people later." />
              )}
            </div>
            <p className="mt-2.5 rounded-xl bg-mist px-3 py-2.5 text-[13px] text-[#3E4A43]">
              Only your contacts can be invited, as members or organizers. They join right away. You&apos;ll be the group&apos;s owner.
            </p>
          </div>
          <ErrorText text={error} />
        </fieldset>

        <FormFooter busy={busy} busyLabel="Creating…" label="Create Group" />
      </form>
    </Modal>
  );
}

function FormFooter({ busy, busyLabel, label }: { busy: boolean; busyLabel: string; label: string }) {
  const { requestClose } = useModal();
  return (
    <div className="flex shrink-0 justify-end gap-2.5 border-t border-line px-6 pt-4 pb-5">
      <button type="button" onClick={() => requestClose()} disabled={busy} className={secondaryButton}>
        Cancel
      </button>
      <button type="submit" disabled={busy} aria-busy={busy} className={`flex items-center gap-2 ${primaryButton}`}>
        {busy && <Spinner />}
        {busy ? busyLabel : label}
      </button>
    </div>
  );
}

/* ---------- Edit group (owner and organizers) ---------- */

export type GroupEdit = {
  name: string;
  description: string;
  /** "keep" leaves the picture alone; null removes it; a File replaces it. */
  picture: File | null | "keep";
};

export function EditGroupDialog({
  group,
  onCancel,
  onSave,
}: {
  /** null = closed. */
  group: Conversation | null;
  onCancel: () => void;
  /** Resolves with an error message, or null when the changes were saved. */
  onSave: (edit: GroupEdit) => Promise<string | null>;
}) {
  // Keyed by group, so the form starts from that group's saved values each time it opens.
  return group ? <EditGroupForm key={group.id} group={group} onCancel={onCancel} onSave={onSave} /> : null;
}

function EditGroupForm({
  group,
  onCancel,
  onSave,
}: {
  group: Conversation;
  onCancel: () => void;
  onSave: (edit: GroupEdit) => Promise<string | null>;
}) {
  const [name, setName] = useState(group.name ?? "");
  const [description, setDescription] = useState(group.description ?? "");
  const [picture, setPicture] = useState<File | null | "keep">("keep");
  const [preview, setPreview] = useState<string | null>(group.picture_url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useBlobCleanup(preview);

  const trimmed = name.trim();
  const dirty = name !== (group.name ?? "") || description !== (group.description ?? "") || picture !== "keep";

  return (
    <Modal onClose={onCancel} labelledBy="edit-group-title" className="max-w-[540px]" dirty={dirty} busy={busy}>
      <DialogHeader id="edit-group-title" title="Edit Group" />
      <form
        className="flex min-h-0 flex-col"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!trimmed) {
            setNameMissing(true);
            nameInput.current?.focus();
            return;
          }
          setBusy(true);
          setError(null);
          const problem = await onSave({ name: trimmed, description: description.trim(), picture });
          if (problem) {
            setError(problem);
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-4 disabled:opacity-70">
          <GroupFields
            name={name}
            onName={(v) => {
              setName(v);
              if (v.trim()) setNameMissing(false);
            }}
            description={description}
            onDescription={setDescription}
            preview={preview}
            gradient={group.avatar_gradient ?? 0}
            onPicture={(file) => {
              setError(null);
              setPicture(file);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            onError={setError}
            nameMissing={nameMissing}
            nameInput={nameInput}
            nameError="Add a group name to save."
          />
          <ErrorText text={error} />
        </fieldset>

        <FormFooter busy={busy} busyLabel="Saving…" label="Save Changes" />
      </form>
    </Modal>
  );
}

/* ---------- Details: members, inviting, roles and ownership ---------- */
//   Owner: invite or remove anyone, make people members or organizers, hand over ownership.
//   Organizer: invite contacts as members, remove only the people they added.
//   Member: view only. (The database enforces all of this too.)

const ROLE_CHIP: Record<Role, string> = {
  owner: "bg-brand text-white",
  organizer: "bg-tint text-brand",
  member: "bg-mist text-muted",
};

type Action = (userId: string) => Promise<string | null>;

type DetailsProps = {
  group: Conversation | null;
  mode: "details" | "invite";
  me: string;
  contacts: ContactsState;
  onRetryContacts: () => void;
  onMode: (mode: "details" | "invite") => void;
  onClose: () => void;
  onInvite: (inviteIds: string[], organizerIds: string[]) => Promise<string | null>;
  onSetRole: (userId: string, role: "member" | "organizer") => Promise<string | null>;
  onRemove: Action;
  onTransfer: Action;
  onDelete: () => Promise<string | null>;
  /** Owner and organizers: open Edit Group. */
  onEdit: () => void;
};

export function DetailsDialog(props: DetailsProps) {
  // Mounted only while open (keyed by group), so it always opens fresh.
  return props.group ? <DetailsWindow key={props.group.id} {...props} group={props.group} /> : null;
}

function DetailsWindow({
  group,
  mode,
  me,
  contacts,
  onRetryContacts,
  onMode,
  onClose,
  onInvite,
  onSetRole,
  onRemove,
  onTransfer,
  onDelete,
  onEdit,
}: DetailsProps & { group: Conversation }) {
  const [picked, setPicked] = useState<Picked>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "owner"; userId: string } | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const myRole = group.members.find((m) => m.user_id === me)?.role ?? "member";
  const isOwner = myRole === "owner";
  const canInvite = myRole === "owner" || myRole === "organizer";
  const order: Record<Role, number> = { owner: 0, organizer: 1, member: 2 };
  const members = [...group.members].sort(
    (a, b) =>
      order[a.role] - order[b.role] || Number(b.user_id === me) - Number(a.user_id === me) || personName(a).localeCompare(personName(b)),
  );
  // Contacts who aren't in the group yet.
  const taken = new Set(group.members.map((m) => m.user_id));
  const list = contacts.status === "ready" ? contacts.list : [];
  const invitable = list.filter((p) => !taken.has(p.user_id));
  const shown = invitable.filter((p) => matches(p, search));
  const pickedIds = idsWith(picked);

  // What I may do to someone else in the list.
  const canManage = (m: (typeof members)[number]) =>
    m.user_id !== me && m.role !== "owner" && (isOwner || (myRole === "organizer" && m.added_by === me));

  async function run(key: string, action: () => Promise<string | null>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    const problem = await action();
    setBusy(null);
    if (problem) setError(problem);
    else {
      setConfirm(null);
      setManaging(null);
      setConfirmDelete(false);
    }
  }

  const resetPanels = () => {
    setConfirmDelete(false);
    setManaging(null);
    setConfirm(null);
    setError(null);
    setNotice(null);
  };
  const backToDetails = () => {
    setPicked({});
    setSearch("");
    setError(null);
    onMode("details");
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="details-title"
      className="max-w-[520px]"
      dirty={mode === "invite" && pickedIds.length > 0}
      busy={busy !== null}
    >
      <div className="flex shrink-0 items-start gap-3.5 border-b border-line px-6 pt-5 pb-4">
        <Avatar src={group.picture_url} name={group.name ?? ""} seed={group.id} size={52} shape="square" gradient={group.avatar_gradient} />
        <div className="min-w-0 flex-1">
          <h2 id="details-title" className="truncate text-xl font-extrabold">
            {group.name}
          </h2>
          <p className="mt-0.5 text-sm text-[#3E4A43]">{group.description || "No description yet."}</p>
        </div>
        {canInvite && mode === "details" && (
          <button
            type="button"
            onClick={() => {
              resetPanels();
              onEdit();
            }}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-sm font-bold hover:bg-mist"
          >
            <PenIcon className="h-4 w-4" />
            Edit Group
          </button>
        )}
        <CloseButton />
      </div>

      {mode === "details" ? (
        <>
          <div className="flex shrink-0 items-center justify-between px-6 pt-4">
            <h3 className="font-extrabold">Members · {group.members.length}</h3>
            {canInvite && (
              <button
                type="button"
                onClick={() => {
                  resetPanels();
                  onMode("invite");
                }}
                className="flex h-11 items-center gap-1.5 rounded-[10px] bg-brand px-3.5 text-sm font-bold text-white hover:bg-brand-hover"
              >
                <PlusIcon className="h-4 w-4" />
                Invite Contacts
              </button>
            )}
          </div>

          <div className="mt-2 min-h-0 overflow-y-auto px-4">
            <ul>
              {members.map((m) => {
                const open = managing === m.user_id;
                const name = personName(m);
                const panelId = `manage-${m.user_id}`;
                return (
                  <li key={m.user_id} className="border-b border-[#EEF1EA] last:border-b-0">
                    <div className="flex items-center gap-3 px-2 py-2.5">
                      <Avatar src={m.avatar_url} name={name} seed={m.user_id} size={40} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-bold">
                          {name}
                          {m.user_id === me && <span className="font-medium text-muted"> (you)</span>}
                        </span>
                        <span className="truncate text-[13px] text-muted">@{m.username}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${ROLE_CHIP[m.role]}`}>
                        {ROLE_LABEL[m.role]}
                      </span>
                      {canManage(m) &&
                        (isOwner ? (
                          // Owner: pen next to the role opens the role choices.
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={panelId}
                            aria-label={`Change ${name}'s role`}
                            title="Change role"
                            onClick={() => {
                              setManaging(open ? null : m.user_id);
                              setConfirm(null);
                              setError(null);
                            }}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border ${
                              open ? "border-brand bg-tint text-brand" : "border-line bg-white text-muted hover:bg-mist hover:text-ink"
                            }`}
                          >
                            <PenIcon className="h-[18px] w-[18px]" />
                          </button>
                        ) : (
                          // Organizer: can only remove people they added.
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={panelId}
                            aria-label={`Remove ${name}`}
                            onClick={() => {
                              setManaging(open ? null : m.user_id);
                              setConfirm(open ? null : { kind: "remove", userId: m.user_id });
                              setError(null);
                            }}
                            className="h-11 shrink-0 rounded-[10px] border border-line bg-white px-3 text-[13px] font-bold hover:bg-mist"
                          >
                            Remove
                          </button>
                        ))}
                    </div>

                    {open && (
                      <div id={panelId} className="mx-2 mb-3 rounded-2xl bg-mist p-3">
                        {confirm?.userId === m.user_id ? (
                          <div className={confirm.kind === "owner" ? "-m-3 rounded-2xl bg-butter p-3" : ""}>
                            {confirm.kind === "owner" ? (
                              <>
                                <p className="text-sm font-extrabold text-honey">Hand over ownership?</p>
                                <p className="mt-1 text-sm text-ink">
                                  {m.first_name} will become the owner. You&apos;ll lose ownership of this group and become an organizer.
                                </p>
                              </>
                            ) : (
                              <p className="text-sm font-bold">Remove {m.first_name} from the group?</p>
                            )}
                            <div className="mt-2.5 flex gap-2">
                              <button
                                type="button"
                                autoFocus
                                disabled={busy !== null}
                                onClick={() =>
                                  run(`${confirm.kind}-${m.user_id}`, () =>
                                    confirm.kind === "remove" ? onRemove(m.user_id) : onTransfer(m.user_id),
                                  )
                                }
                                className="flex h-11 items-center gap-2 rounded-[10px] bg-ink px-3.5 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
                              >
                                {busy && <Spinner />}
                                {confirm.kind === "remove" ? "Yes, Remove" : "Yes, Make Owner"}
                              </button>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() => (isOwner ? setConfirm(null) : setManaging(null))}
                                className="h-11 rounded-[10px] border border-line bg-white px-3.5 text-sm font-bold hover:bg-white/60 disabled:opacity-60"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <p className="px-1 text-[11px] font-bold tracking-wider text-muted uppercase">Role for {m.first_name}</p>
                            <div role="radiogroup" aria-label={`Role for ${name}`} className="mt-1.5 flex flex-col gap-1">
                              {(["member", "organizer", "owner"] as const).map((r) => {
                                const current = m.role === r;
                                return (
                                  <button
                                    key={r}
                                    type="button"
                                    role="radio"
                                    aria-checked={current}
                                    disabled={busy !== null}
                                    onClick={() => {
                                      if (current) return;
                                      if (r === "owner") setConfirm({ kind: "owner", userId: m.user_id });
                                      else run(`role-${m.user_id}`, () => onSetRole(m.user_id, r));
                                    }}
                                    className={`flex h-11 items-center justify-between rounded-[10px] border px-3 text-left text-sm font-bold disabled:opacity-60 ${
                                      current ? "border-brand bg-tint text-brand" : "border-line bg-white hover:bg-tint"
                                    }`}
                                  >
                                    {r === "owner" ? "Make Owner" : ROLE_LABEL[r]}
                                    {current && <CheckIcon className="h-4 w-4" />}
                                  </button>
                                );
                              })}
                            </div>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => setConfirm({ kind: "remove", userId: m.user_id })}
                              className="mt-3 h-11 rounded-[10px] border border-line bg-white px-3.5 text-sm font-bold hover:bg-butter disabled:opacity-60"
                            >
                              Remove from Group
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="shrink-0 px-6 pt-2 pb-5">
            <ErrorText text={error} />
            {notice && (
              <p role="status" className="flex items-center gap-1.5 text-sm font-bold text-brand">
                <CheckIcon className="h-4 w-4" />
                {notice}
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              {isOwner
                ? "As the owner, you can invite or remove anyone, change roles, and hand ownership to someone else."
                : myRole === "organizer"
                  ? "As an organizer, you can invite your contacts as members and remove people you added."
                  : "Only the owner and organizers can invite or remove people."}
            </p>

            {isOwner &&
              (confirmDelete ? (
                <div className="mt-4 rounded-2xl bg-butter p-4">
                  <p className="text-sm font-extrabold text-honey">Delete “{group.name}”?</p>
                  <p className="mt-1 text-sm text-ink">
                    This deletes the group for all {group.members.length} {group.members.length === 1 ? "member" : "members"}. It can&apos;t
                    be undone.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      autoFocus
                      disabled={busy !== null}
                      onClick={() => run("delete", onDelete)}
                      className="flex h-11 items-center gap-2 rounded-[10px] bg-ink px-4 text-sm font-bold text-white hover:bg-black disabled:opacity-60"
                    >
                      {busy === "delete" && <Spinner />}
                      {busy === "delete" ? "Deleting…" : "Yes, Delete Group"}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirmDelete(false)}
                      className="h-11 rounded-[10px] border border-line bg-white px-4 text-sm font-bold hover:bg-white/60 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    resetPanels();
                    setConfirmDelete(true);
                  }}
                  className="mt-4 h-11 w-full rounded-xl border border-line bg-white text-sm font-bold text-ink hover:bg-butter"
                >
                  Delete Group
                </button>
              ))}
          </div>
        </>
      ) : (
        <InvitePanel
          isOwner={isOwner}
          contacts={contacts}
          onRetryContacts={onRetryContacts}
          hasContacts={list.length > 0}
          invitable={invitable}
          shown={shown}
          search={search}
          onSearch={setSearch}
          picked={picked}
          onPicked={setPicked}
          busy={busy === "invite"}
          error={error}
          onBack={backToDetails}
          onSend={async () => {
            if (busy || !pickedIds.length) return;
            const names = pickedIds.map((id) => list.find((p) => p.user_id === id)?.first_name ?? "them");
            setBusy("invite");
            setError(null);
            const problem = await onInvite(pickedIds, idsWith(picked, "organizer"));
            setBusy(null);
            if (problem) return setError(problem); // picks stay, so they can try again
            backToDetails();
            setNotice(names.length === 1 ? `${names[0]} was added to the group.` : `${names.length} people were added to the group.`);
          }}
        />
      )}
    </Modal>
  );
}

function InvitePanel({
  isOwner,
  contacts,
  onRetryContacts,
  hasContacts,
  invitable,
  shown,
  search,
  onSearch,
  picked,
  onPicked,
  busy,
  error,
  onBack,
  onSend,
}: {
  isOwner: boolean;
  contacts: ContactsState;
  onRetryContacts: () => void;
  hasContacts: boolean;
  invitable: ContactRow[];
  shown: ContactRow[];
  search: string;
  onSearch: (v: string) => void;
  picked: Picked;
  onPicked: (update: (p: Picked) => Picked) => void;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSend: () => void;
}) {
  const { requestClose } = useModal();
  const count = idsWith(picked).length;
  const searchInput = useRef<HTMLDivElement>(null);

  // Moving into this view: put focus on the search box (or the first thing to act on).
  useEffect(() => {
    searchInput.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, []);

  return (
    <>
      <div ref={searchInput} className="shrink-0 px-6 pt-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => requestClose(onBack)}
          className="flex h-11 items-center gap-1 text-sm font-bold text-brand disabled:opacity-60"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Details
        </button>
        <h3 className="font-extrabold">
          Invite contacts <span className="font-medium text-muted">· {count} selected</span>
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          {isOwner ? "They join the group right away." : "People you invite join the group as members right away."}
        </p>
        {contacts.status === "ready" && invitable.length > 0 && (
          <div className="mt-2.5">
            <SearchBox value={search} onChange={onSearch} label="Search your contacts" />
          </div>
        )}
      </div>
      <div className="mt-2 min-h-0 overflow-y-auto px-4">
        <fieldset disabled={busy} className="disabled:opacity-70">
          <legend className="sr-only">Contacts to invite</legend>
          {contacts.status !== "ready" ? (
            <div className="mx-2">
              <ContactsNotReady state={contacts} onRetry={onRetryContacts} />
            </div>
          ) : invitable.length ? (
            <ul className="flex flex-col gap-0.5">
              {!shown.length && <li className="px-2.5 py-3 text-sm text-muted">No contacts match “{search.trim()}”.</li>}
              {shown.map((p) => (
                <PickRow
                  key={p.user_id}
                  person={p}
                  role={picked[p.user_id]}
                  onToggle={() => onPicked((l) => toggle(l, p.user_id))}
                  // Only the owner can invite people as organizers.
                  onRole={isOwner ? (r) => onPicked((l) => ({ ...l, [p.user_id]: r })) : undefined}
                />
              ))}
            </ul>
          ) : hasContacts ? (
            <p className="mx-2 rounded-2xl bg-mist p-4 text-center text-sm text-muted">All your contacts are already in this group.</p>
          ) : (
            <div className="mx-2">
              <NoContacts text="You don't have any contacts yet." />
            </div>
          )}
        </fieldset>
      </div>
      <div className="flex shrink-0 flex-col gap-3 px-6 pt-4 pb-5">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2.5">
          <button type="button" disabled={busy} onClick={() => requestClose(onBack)} className={secondaryButton}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!count || busy}
            aria-busy={busy}
            onClick={onSend}
            className={`flex items-center gap-2 ${primaryButton}`}
          >
            {busy && <Spinner />}
            {busy ? "Inviting…" : "Invite to Group"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ---------- New DM ---------- */

export function NewDmDialog(props: {
  open: boolean;
  contacts: ContactsState;
  onRetryContacts: () => void;
  onClose: () => void;
  onPick: (userId: string) => Promise<string | null>;
}) {
  return props.open ? <NewDmWindow {...props} /> : null;
}

function NewDmWindow({
  contacts,
  onRetryContacts,
  onClose,
  onPick,
}: {
  contacts: ContactsState;
  onRetryContacts: () => void;
  onClose: () => void;
  onPick: (userId: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const list = contacts.status === "ready" ? contacts.list : [];
  const shown = list.filter((p) => matches(p, search));

  return (
    <Modal onClose={onClose} labelledBy="new-dm-title" className="max-w-[440px]" busy={busy !== null}>
      <DialogHeader id="new-dm-title" title="New DM" />
      <p className="shrink-0 px-6 text-sm text-muted">Pick a contact to message.</p>
      {contacts.status === "ready" && list.length > 0 && (
        <div className="shrink-0 px-6 pt-3">
          <SearchBox value={search} onChange={setSearch} label="Search your contacts" autoFocus />
        </div>
      )}
      <div className="mt-3 min-h-0 overflow-y-auto px-4 pb-5">
        {contacts.status !== "ready" ? (
          <div className="mx-2">
            <ContactsNotReady state={contacts} onRetry={onRetryContacts} />
          </div>
        ) : list.length ? (
          <ul className="flex flex-col gap-0.5">
            {!shown.length && <li className="px-2.5 py-3 text-sm text-muted">No contacts match “{search.trim()}”.</li>}
            {shown.map((p) => (
              <li key={p.user_id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    if (busy) return;
                    setBusy(p.user_id);
                    setError(null);
                    const problem = await onPick(p.user_id);
                    setBusy(null);
                    if (problem) setError(problem);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-mist disabled:opacity-60"
                >
                  <Avatar src={p.avatar_url} name={personName(p)} seed={p.user_id} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold">{personName(p)}</span>
                    <span className="truncate text-[13px] text-muted">@{p.username}</span>
                  </span>
                  {busy === p.user_id && <span className="text-xs font-bold text-muted">Opening…</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mx-2">
            <NoContacts text="You can message people once they're your contacts." />
          </div>
        )}
        <div className="mt-2 px-2">
          <ErrorText text={error} />
        </div>
      </div>
    </Modal>
  );
}
