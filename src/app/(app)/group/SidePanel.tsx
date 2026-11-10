"use client";

import Avatar from "@/components/Avatar";
import { InfoIcon } from "@/components/app/icons";
import { PaymentLogo, type PaymentProvider } from "@/components/app/PaymentLogos";
import { formatUsPhone } from "@/lib/profile";
import { memberLabel, otherMember, personName, type Conversation } from "./types";

const HANDLE_LABEL: Record<PaymentProvider, string> = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };

// The right column: about the group, or about the other person in a DM.
export default function SidePanel({
  chat,
  me,
  groups,
  onDetails,
  onOpen,
  className,
}: {
  /** null when you have no conversations yet: the panel shows empty cards. */
  chat: Conversation | null;
  me: string;
  /** All your groups, for "Groups in common" in a DM. */
  groups: Conversation[];
  onDetails: () => void;
  onOpen: (id: string) => void;
  className: string;
}) {
  return (
    <aside aria-label="About this chat" className={`min-h-0 flex-col gap-4 overflow-y-auto ${className}`}>
      {!chat ? (
        <EmptyPanel />
      ) : chat.kind === "group" ? (
        <GroupPanel chat={chat} me={me} onDetails={onDetails} />
      ) : (
        <PersonPanel chat={chat} me={me} groups={groups} onOpen={onOpen} />
      )}
    </aside>
  );
}

function GroupPanel({ chat, me, onDetails }: { chat: Conversation; me: string; onDetails: () => void }) {
  const owner = chat.members.find((m) => m.role === "owner");
  const organizers = chat.members.filter((m) => m.role === "organizer");
  const myRole = chat.members.find((m) => m.user_id === me)?.role;
  const ownerLine = owner ? (owner.user_id === me ? "You're the owner." : `Owner: ${personName(owner)}`) : "";
  const organizerNames = organizers.map((m) => (m.user_id === me ? "you" : personName(m)));
  const organizerLine = organizerNames.length
    ? `${organizerNames.length === 1 ? "Organizer" : "Organizers"}: ${organizerNames.join(", ")}`
    : "";

  return (
    <>
      <Panel title="Group overview">
        <p className="mt-2.5 text-sm text-[#3E4A43]">{chat.description || "No description yet."}</p>
        <div className="mt-3.5 flex items-center">
          {chat.members.slice(0, 5).map((m, i) => (
            <span key={m.user_id} title={personName(m)} className={`rounded-full ring-2 ring-white ${i ? "-ml-2" : ""}`}>
              <Avatar src={m.avatar_url} name={personName(m)} seed={m.user_id} size={36} />
            </span>
          ))}
          {chat.members.length > 5 && (
            <span className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-mist text-xs font-bold text-muted ring-2 ring-white">
              +{chat.members.length - 5}
            </span>
          )}
        </div>
        {ownerLine && <p className="mt-2.5 text-[13px] text-muted">{ownerLine}</p>}
        {organizerLine && <p className="mt-0.5 text-[13px] text-muted">{organizerLine}</p>}
        {/* Members, adding, removing and roles all live in the Details window. */}
        <button
          type="button"
          onClick={onDetails}
          className={`mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold ${
            myRole === "owner" || myRole === "organizer"
              ? "bg-brand text-white hover:bg-brand-hover"
              : "border border-line bg-white hover:bg-mist"
          }`}
        >
          <InfoIcon className="h-[18px] w-[18px]" />
          Details
        </button>
      </Panel>

      <Panel title="Needs your attention">
        <p className="mt-2 text-sm text-muted">You&apos;re all set here.</p>
      </Panel>

      <Panel title="Recent files">
        <p className="mt-2 text-sm text-muted">Nothing shared yet.</p>
      </Panel>
    </>
  );
}

function EmptyPanel() {
  return (
    <>
      <Panel title="Group overview">
        <p className="mt-2.5 text-sm text-muted">Pick or start a group to see its description and members here.</p>
      </Panel>
      <Panel title="Needs your attention">
        <p className="mt-2 text-sm text-muted">You&apos;re all set here.</p>
      </Panel>
      <Panel title="Recent files">
        <p className="mt-2 text-sm text-muted">Nothing shared yet.</p>
      </Panel>
    </>
  );
}

function PersonPanel({
  chat,
  me,
  groups,
  onOpen,
}: {
  chat: Conversation;
  me: string;
  groups: Conversation[];
  onOpen: (id: string) => void;
}) {
  const other = otherMember(chat, me);
  if (!other) {
    return (
      <Panel title="About">
        <p className="mt-2 text-sm text-muted">This person deleted their account.</p>
      </Panel>
    );
  }

  const handles: { key: PaymentProvider; value: string }[] = [];
  if (other.venmo_username) handles.push({ key: "venmo", value: `@${other.venmo_username}` });
  if (other.paypal_username) handles.push({ key: "paypal", value: `paypal.me/${other.paypal_username}` });
  if (other.zelle_contact) handles.push({ key: "zelle", value: formatUsPhone(other.zelle_contact) });
  handles.sort((a, b) => Number(b.key === other.preferred_handle) - Number(a.key === other.preferred_handle));
  const common = groups.filter((g) => g.members.some((m) => m.user_id === other.user_id));

  return (
    <>
      <section className="shrink-0 rounded-3xl border border-line bg-white px-5 py-6 text-center">
        <span className="inline-block">
          <Avatar src={other.avatar_url} name={personName(other)} seed={other.user_id} size={72} />
        </span>
        <p className="mt-3 truncate text-lg font-extrabold">{personName(other)}</p>
        <p className="truncate text-sm text-muted">@{other.username}</p>
      </section>

      <Panel title="Payment handles">
        {handles.length ? (
          <ul className="mt-3 flex flex-col gap-2.5 text-sm">
            {handles.map((h) => (
              <li key={h.key} className="flex items-center gap-2.5">
                <PaymentLogo provider={h.key} className="h-7 w-7" />
                <span className="w-[52px] shrink-0 font-bold">{HANDLE_LABEL[h.key]}</span>
                <span className="min-w-0 truncate text-[#3E4A43]">{h.value}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{other.first_name} hasn&apos;t added any yet.</p>
        )}
      </Panel>

      <Panel title="Groups in common">
        {common.length ? (
          <ul className="mt-2 flex flex-col">
            {common.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onOpen(g.id)}
                  className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-mist"
                >
                  <Avatar src={g.picture_url} name={g.name ?? ""} seed={g.id} size={40} shape="square" gradient={g.avatar_gradient} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-bold">{g.name}</span>
                    <span className="text-xs text-muted">{memberLabel(g.members.length)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No groups in common yet.</p>
        )}
      </Panel>
    </>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="shrink-0 rounded-3xl border border-line bg-white p-5">
      <h3 className="text-lg font-extrabold">{title}</h3>
      {children}
    </section>
  );
}
