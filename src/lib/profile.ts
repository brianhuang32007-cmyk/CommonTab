// Shared profile rules, used by the form (instant feedback) and the server (final check).
// The database enforces the same rules (see supabase/migrations).

export const MIN_PASSWORD = 8;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const MIN_AGE = 13;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function normalizeUsername(raw: string) {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export function usernameProblem(username: string): string | null {
  if (username.length < 3) return "At least 3 characters.";
  if (username.length > 20) return "20 characters at most.";
  if (!USERNAME_PATTERN.test(username)) return "Use only letters, numbers and underscores.";
  return null;
}

/** Latest birthday (YYYY-MM-DD) allowed for someone who is at least MIN_AGE today. */
export function latestAllowedBirthday(today = new Date()) {
  const d = new Date(Date.UTC(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate()));
  return d.toISOString().slice(0, 10);
}

export function birthdayProblem(birthday: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || Number.isNaN(Date.parse(birthday))) {
    return "Enter your birthday.";
  }
  if (birthday < "1900-01-01") return "Enter a real birthday.";
  if (birthday > latestAllowedBirthday()) return `You need to be at least ${MIN_AGE} to use CommonTab.`;
  return null;
}

// ---- Payment handles (all optional; empty means "not added") ----

/** "@Maya-Lee" → "Maya-Lee" */
export function normalizeVenmo(raw: string) {
  return raw.trim().replace(/^@/, "");
}
export function venmoProblem(v: string): string | null {
  if (!v) return null;
  if (!/^[A-Za-z0-9_-]{5,30}$/.test(v)) return "Venmo usernames are 5–30 letters, numbers, - or _.";
  return null;
}

/** "https://www.paypal.me/MayaLee", "paypal.me/MayaLee" or "MayaLee" → "MayaLee" */
export function normalizePaypal(raw: string) {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?paypal\.me\//i, "")
    .replace(/^@/, "")
    .replace(/\/+$/, "");
}
export function paypalProblem(v: string): string | null {
  if (!v) return null;
  if (!/^[A-Za-z0-9]{1,20}$/.test(v)) return "Enter your PayPal.me name: up to 20 letters and numbers.";
  return null;
}

/** "(555) 123-4567" or "+1 555 123 4567" → "+15551234567". Anything else is returned as typed. */
export function normalizeUsPhone(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return v; // left as typed so the matching *Problem check can flag it
}
export function phoneProblem(v: string): string | null {
  if (!v) return null;
  if (!/^\+1\d{10}$/.test(v)) return "Enter a 10-digit US phone number.";
  return null;
}

/** Email (lowercased) or US phone (as +1XXXXXXXXXX). Returns "" when empty. */
export function normalizeZelle(raw: string) {
  const v = raw.trim();
  if (!v) return "";
  if (v.includes("@")) return v.toLowerCase();
  return normalizeUsPhone(v);
}
export function zelleProblem(v: string): string | null {
  if (!v) return null;
  if (/^\+1\d{10}$/.test(v)) return null;
  if (v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return null;
  return "Enter the email or US phone number you use with Zelle.";
}

export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return "Required.";
  if (n.length > 50) return "50 characters at most.";
  return null;
}
