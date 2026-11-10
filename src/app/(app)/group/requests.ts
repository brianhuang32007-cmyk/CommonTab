// Payment requests: shapes from supabase/migrations/20261110110000_payment_requests.sql,
// and the plain-code money helpers (amounts are always whole cents; no AI math).

/** A request as the signed-in person sees it (payment_request_view). */
export type PaymentRequestView = {
  id: string;
  conversation_id: string;
  title: string;
  total_cents: number;
  /** "YYYY-MM-DD" or null. */
  due_date: string | null;
  status: "open" | "settled" | "cancelled";
  created_by: string | null;
  payee_id: string | null;
  /** Your share, or null if you're not in the split. */
  my_share_cents: number | null;
  my_share_status: "pending" | "confirmed" | "marked_paid" | "settled" | "disputed" | "waived" | null;
  share_count: number;
  settled_count: number;
  /** What's still unpaid across everyone. */
  outstanding_cents: number;
  /** A digital receipt is attached (missing before migration 20261110140000). */
  has_receipt?: boolean;
  /** Everyone in the split and where they are (missing before migration 20261110120000). */
  shares?: { user_id: string; amount_cents: number; status: PaymentRequestView["my_share_status"] }[];
};

/** A row in your requests list (my_payment_requests). */
export type PaymentRequestRow = PaymentRequestView & {
  direction: "sent" | "received";
  conversation_name: string | null;
  conversation_kind: "group" | "dm";
  /** When it was requested, and by whom (missing before migration 20261110180000). */
  created_at?: string;
  requester_first_name?: string | null;
  requester_last_name?: string | null;
};

/** The AI's digital receipt, as the requester checked it. */
export type DigitalReceipt = {
  is_receipt: boolean;
  readable: boolean;
  problem: string | null;
  vendor: string | null;
  date: string | null;
  items: { name: string; amount_cents: number }[];
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  total_cents: number | null;
  currency: string | null;
};

export const TOTAL_MAX_CENTS = 1_000_000; // $10,000

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** "$12.50", "12.5", "1,200" → whole cents; anything else → null. */
export function parseCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, part = ""] = clean.split(".");
  return Number(whole) * 100 + Number(part.padEnd(2, "0"));
}

/** "33.33" or "25" (0 to 100, up to two decimals) → hundredths of a percent (3333, 2500); else null. */
export function parsePercent(text: string): number | null {
  const clean = text.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, part = ""] = clean.split(".");
  const bp = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  return bp <= 10000 ? bp : null;
}

/** Hundredths of a percent as an editable "33.34". */
export const percentText = (bp: number) => String(bp / 100);

/** Splits whole cents by percentages (in hundredths, adding up to 10,000). Each share is
 *  rounded down, then leftover cents go to the first people with a share. */
export function splitByPercent(totalCents: number, bps: number[]): number[] {
  const shares = bps.map((bp) => Math.floor((totalCents * bp) / 10000));
  let leftover = totalCents - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; leftover > 0 && i < shares.length; i++) {
    if (bps[i] > 0) {
      shares[i] += 1;
      leftover -= 1;
    }
  }
  return shares;
}

/** Cents as an editable "12.50". */
export const centsText = (cents: number) => (cents / 100).toFixed(2);

/** Splits whole cents evenly; extra cents go to the first people ($100 / 3 = 33.34, 33.33, 33.33). */
export function splitEvenly(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const extra = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "2026-11-13" as that calendar day where you are (not midnight UTC, which can show the day before). */
export function localDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Today as "YYYY-MM-DD", in your time zone. */
export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "Due Nov 13", "Due today", "Overdue · Nov 9", or "No due date"; overdue shows in yellow, never red. */
export function dueLabel(due: string | null): { text: string; overdue: boolean } {
  if (!due) return { text: "No due date", overdue: false };
  const today = todayIso();
  const pretty = localDay(due).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (due < today) return { text: `Overdue · ${pretty}`, overdue: true };
  if (due === today) return { text: "Due today", overdue: false };
  return { text: `Due ${pretty}`, overdue: false };
}

/** Reminder deadlines: "2 days overdue", "Due today", "Due tomorrow", "Due Nov 13", or "No due date",
 *  with a tone for the color (overdue, soon = today or tomorrow, later, none). Uses your time zone. */
export function deadlineLabel(due: string | null): { text: string; tone: "overdue" | "soon" | "later" | "none" } {
  if (!due) return { text: "No due date", tone: "none" };
  const days = Math.round((localDay(due).getTime() - localDay(todayIso()).getTime()) / 86_400_000);
  if (days < 0) return { text: `${-days} ${days === -1 ? "day" : "days"} overdue`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "soon" };
  if (days === 1) return { text: "Due tomorrow", tone: "soon" };
  const sameYear = localDay(due).getFullYear() === new Date().getFullYear();
  return {
    text: `Due ${localDay(due).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`,
    tone: "later",
  };
}

export const detailsHref = (chatId: string, requestId: string) => `/group/${chatId}/payments/${requestId}`;
export const settleHref = (chatId: string, requestId: string) => `/group/${chatId}/payments/${requestId}/settle`;
export const disputeHref = (chatId: string, requestId: string) => `/group/${chatId}/payments/${requestId}/dispute`;
/** One dispute's own page: the chat on the left, the negotiation tool on the right. */
export const disputeRoomHref = (chatId: string, requestId: string, disputeId: string) =>
  `/group/${chatId}/payments/${requestId}/disputes/${disputeId}`;

/** Everything the Details page shows (payment_request_details). */
export type PaymentRequestDetails = PaymentRequestView & {
  split: "equal" | "custom";
  created_at: string;
  receipt: DigitalReceipt | null;
  receipt_path: string | null;
  conversation_name: string | null;
  conversation_kind: "group" | "dm";
  my_role: "owner" | "organizer" | "member" | null;
  creator: { user_id: string; first_name: string; last_name: string } | null;
  payee: {
    user_id: string;
    first_name: string;
    last_name: string;
    username: string;
    avatar_url: string | null;
    venmo_username: string | null;
    paypal_username: string | null;
    zelle_contact: string | null;
    preferred_handle: "venmo" | "paypal" | "zelle" | null;
  } | null;
  people: {
    user_id: string;
    first_name: string;
    last_name: string;
    username: string;
    avatar_url: string | null;
    amount_cents: number;
    status: NonNullable<PaymentRequestView["my_share_status"]>;
    updated_at: string;
  }[];
  /** What happened to each share (missing before migration 20261110150000). */
  events?: ShareEvent[];
  /** Payments you made or received on this request (missing before migration 20261110160000). */
  transfers?: PaymentTransfer[];
};

/** A demo in-app payment: no real money moves; it records who paid whom, how and when. */
export type PaymentTransfer = {
  id: string;
  payer_id: string;
  first_name: string;
  last_name: string;
  amount_cents: number;
  method: PayMethod;
  confirmation: string;
  created_at: string;
};

export type PayMethod = "venmo" | "paypal" | "zelle";
export const PAY_METHOD_LABEL: Record<PayMethod, string> = { venmo: "Venmo", paypal: "PayPal", zelle: "Zelle" };

/** One line of a share's history, visible to the group (never a dispute's reason or chat). */
export type ShareEvent = {
  id: number;
  user_id: string;
  actor_id: string | null;
  kind: "confirmed" | "disputed" | "amount_changed" | "waived" | "paid" | "dispute_canceled";
  amount_cents: number | null;
  previous_cents: number | null;
  created_at: string;
  first_name: string;
};

/** A dispute as one of its two sides sees it (my_payment_disputes). */
export type PaymentDispute = {
  id: string;
  member: { user_id: string; first_name: string; last_name: string; username: string; avatar_url: string | null };
  reason: string;
  original_cents: number;
  status: "open" | "resolved";
  resolution: "new_amount" | "waived" | "withdrawn" | null;
  final_cents: number | null;
  created_at: string;
  resolved_at: string | null;
  messages: { id: string; author_id: string | null; body: string; created_at: string }[];
  proposals: DisputeProposal[];
};

export type DisputeProposal = {
  id: string;
  author_id: string | null;
  kind: "amount" | "cancel";
  amount_cents: number | null;
  status: "open" | "accepted" | "countered" | "persisted" | "replaced" | "canceled";
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
};

export const SHARE_STATUS: Record<NonNullable<PaymentRequestView["my_share_status"]>, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-mist text-muted" },
  confirmed: { label: "Confirmed", className: "bg-tint text-brand" },
  marked_paid: { label: "Marked paid", className: "bg-tint text-brand" },
  settled: { label: "Paid", className: "bg-brand text-white" },
  // No red for money states: yellow with dark text.
  disputed: { label: "Disputed", className: "bg-butter text-honey" },
  waived: { label: "Waived", className: "bg-mist text-muted" },
};

/** "Nov 10, 3:04 PM" */
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
