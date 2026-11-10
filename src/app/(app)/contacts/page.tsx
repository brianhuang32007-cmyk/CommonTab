import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import ContactsView from "./ContactsView";
import type { ContactRow } from "./types";

export const metadata = { title: "Contacts · CommonTab" };
// Reads the login cookie on every request, so it can't be prerendered.
export const instant = false;

export default async function ContactsPage() {
  // Render per request: the login check reads the current time (token expiry).
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_contacts");

  return <ContactsView initialRows={(data as ContactRow[] | null) ?? []} loadError={Boolean(error)} />;
}
