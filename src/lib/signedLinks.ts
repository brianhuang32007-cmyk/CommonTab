import type { createClient } from "@/lib/supabase/client";

// Private files (group pictures, chat files) open through short-lived links that storage only
// gives to people allowed to see them. Links are cached so a refresh doesn't reload every file.

type Client = ReturnType<typeof createClient>;

const LINK_SECONDS = 60 * 60; // links last an hour
const RENEW_BEFORE_MS = 10 * 60 * 1000; // ask for a new one when less than 10 minutes are left
const cache = new Map<string, { url: string; expires: number }>();

/** Resolves with a link for each path in the bucket it could open (others are left out). */
export async function signedLinks(
  supabase: Client,
  bucket: "group-pictures" | "chat-files",
  paths: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const now = Date.now();
  const key = (p: string) => `${bucket}/${p}`;
  const wanted = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const missing = wanted.filter((p) => (cache.get(key(p))?.expires ?? 0) - now < RENEW_BEFORE_MS);

  if (missing.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(missing, LINK_SECONDS);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) cache.set(key(row.path), { url: row.signedUrl, expires: now + LINK_SECONDS * 1000 });
    }
  }

  const links = new Map<string, string>();
  for (const p of wanted) {
    const hit = cache.get(key(p));
    if (hit) links.set(p, hit.url);
  }
  return links;
}
