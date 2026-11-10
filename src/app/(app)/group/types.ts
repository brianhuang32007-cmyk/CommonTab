// Shapes returned by the database functions in supabase/migrations/ (groups, owner, pictures).

export type Role = "owner" | "organizer" | "member";

export type Member = {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: Role;
  /** Who added them to the group (organizers may only remove people they added). */
  added_by: string | null;
  // Only filled in for the other person in a DM.
  venmo_username: string | null;
  paypal_username: string | null;
  zelle_contact: string | null;
  preferred_handle: string | null;
};

/** A row from my_conversations(): a group or DM you're in. */
export type Conversation = {
  id: string;
  kind: "group" | "dm";
  name: string | null;
  description: string | null;
  /** Where the group picture is in (private) storage: "<group id>/<file>". */
  picture_path: string | null;
  /** A short-lived link to show that picture, filled in by the page (null = no picture). */
  picture_url: string | null;
  /** Groups without a picture: which color gradient (0–7) shows behind the initials. */
  avatar_gradient: number | null;
  created_by: string | null;
  created_at: string;
  members: Member[];
  /** Messages mentioning you that you haven't read yet (for the "@ You" badge). */
  unread_mentions: number;
  /** Messages from others you haven't read yet. */
  unread_count: number;
};

export const personName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;

/** The other person in a DM (undefined if they deleted their account). */
export const otherMember = (c: Conversation, me: string) => c.members.find((m) => m.user_id !== me);

/** What a conversation is called in the list and header. */
export function titleOf(c: Conversation, me: string) {
  if (c.kind === "group") return c.name ?? "Group";
  const other = otherMember(c, me);
  return other ? personName(other) : "Former contact";
}

export const memberLabel = (n: number) => `${n} ${n === 1 ? "member" : "members"}`;

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", organizer: "Organizer", member: "Member" };
