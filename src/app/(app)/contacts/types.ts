// Shapes returned by the database functions in supabase/migrations/20261110010000_contacts.sql.

export type Relation = "contact" | "sent" | "received" | "none";

/** A row from my_contacts(): someone you're connected to, or have a pending request with. */
export type ContactRow = {
  user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  relation: Exclude<Relation, "none">;
  starred: boolean;
  requested_at: string;
  venmo_username: string | null;
  paypal_username: string | null;
  zelle_contact: string | null;
  preferred_handle: string | null;
  phone: string | null;
};

/** A row from search_profiles(q). */
export type SearchRow = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  relation: Relation;
  total: number;
};

export const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;
