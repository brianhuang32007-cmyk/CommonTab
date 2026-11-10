// One set of rules for alerts across the app: the bell, Alerts & Reminders, and the badges.
// Plain data (no UI): what each reminder (task) and update is, whether it's unread, and how
// payments are identified, searched and ranked.

import type { ContactRow } from "@/app/(app)/contacts/types";
import { detailsHref, dollars, type PaymentRequestRow } from "@/app/(app)/group/requests";
import type { MessageAlert } from "@/components/app/NotificationsContext";
import { alertKey, isUnreadAlert } from "@/lib/notificationReads";

export type Category = "payments" | "documents" | "general";

/* ---------- Reminders (tasks) ---------- */

/** What a reminder asks you to do. Each kind has its own icon, status and button. */
export type TaskKind = "confirm" | "pay" | "dispute" | "upload-receipt" | "upload-document" | "review-document" | "review-payment";

export type Task = {
  key: string;
  /** Saved read mark (alertKey…). */
  readKey: string;
  kind: TaskKind;
  category: Category;
  title: string;
  group: string;
  detail: string;
  due: string | null;
  cents: number;
  /** When the task arrived (for the unread dot); null if unknown. */
  at: string | null;
  href: string;
};

export const TASK: Record<TaskKind, { status: string; button: string; iconClass: string; icon: "card" | "receipt" | "document" }> = {
  confirm: { status: "Needs confirmation", button: "View request", iconClass: "bg-citron text-brand", icon: "card" },
  pay: { status: "Ready to pay", button: "View request", iconClass: "bg-tint text-brand", icon: "card" },
  dispute: { status: "In dispute", button: "View request", iconClass: "bg-butter text-honey", icon: "card" },
  "upload-receipt": { status: "Receipt requested", button: "Upload receipt", iconClass: "bg-tint text-brand", icon: "receipt" },
  "upload-document": { status: "Document requested", button: "Upload document", iconClass: "bg-tint text-brand", icon: "document" },
  "review-document": {
    status: "Ready to review",
    button: "Review document",
    iconClass: "bg-butter-strong text-[#5C4A0B]",
    icon: "document",
  },
  "review-payment": { status: "Ready to review", button: "Review payment", iconClass: "bg-butter-strong text-[#5C4A0B]", icon: "receipt" },
};

/** Your payment shares that still need you: confirm, pay, or an open dispute. */
export function shareTasks(rows: PaymentRequestRow[] | null): Task[] {
  return (rows ?? []).flatMap((r): Task[] => {
    if (r.direction !== "received" || r.my_share_cents === null) return [];
    const kind: TaskKind | null =
      r.my_share_status === "pending"
        ? "confirm"
        : r.my_share_status === "confirmed"
          ? "pay"
          : r.my_share_status === "disputed"
            ? "dispute"
            : null;
    if (!kind) return [];
    const requester = [r.requester_first_name, r.requester_last_name].filter(Boolean).join(" ");
    const what = kind === "confirm" ? "Confirm your share" : kind === "pay" ? "Pay your share" : "Your share is disputed";
    return [
      {
        key: `${kind}-${r.id}`,
        readKey: alertKey.payment(r.id),
        kind,
        category: "payments",
        title: r.title,
        group: r.conversation_name ?? (r.conversation_kind === "dm" ? "Direct message" : "Group"),
        detail: `${what}: ${dollars(r.my_share_cents)}${requester ? ` · Requested by ${requester}` : ""} · ${paymentRef(r.id)}`,
        due: r.due_date,
        cents: r.my_share_cents,
        at: r.created_at ?? null,
        href: detailsHref(r.conversation_id, r.id),
      },
    ];
  });
}

/* ---------- Updates on your requests ---------- */

/** Something that happened on one of your requests (my_request_events). */
export type RequestEvent = {
  id: number;
  request_id: string;
  conversation_id: string;
  title: string;
  conversation_name: string | null;
  conversation_kind: "group" | "dm";
  kind: "confirmed" | "disputed" | "amount_changed" | "waived" | "paid" | "dispute_canceled";
  user_id: string;
  actor_id: string | null;
  user_first_name: string | null;
  actor_first_name: string | null;
  amount_cents: number | null;
  previous_cents: number | null;
  created_at: string;
  i_am_requester: boolean;
};

/** The event's title and details, from your point of view. */
export function describeEvent(e: RequestEvent): { title: string; detail: string; tone: "done" | "info" | "warn" } {
  const who = e.user_first_name ?? "Someone";
  const amt = dollars(e.amount_cents ?? 0);
  switch (e.kind) {
    case "paid":
      return e.i_am_requester
        ? { title: "Payment received", detail: `${who} paid ${amt}`, tone: "done" }
        : { title: "Payment complete", detail: `You paid ${amt}`, tone: "done" };
    case "confirmed":
      return { title: "Share confirmed", detail: `${who} confirmed their share of ${amt}`, tone: "info" };
    case "disputed":
      return { title: "Share disputed", detail: `${who} disputed their share of ${amt}`, tone: "warn" };
    case "amount_changed":
      return {
        title: "Dispute resolved",
        detail: `${e.i_am_requester ? `${who}'s` : "Your"} share changed from ${dollars(e.previous_cents ?? 0)} to ${amt}`,
        tone: "done",
      };
    case "waived":
      return { title: "Dispute resolved", detail: `${e.i_am_requester ? `${who}'s` : "Your"} payment was canceled`, tone: "done" };
    case "dispute_canceled":
      return { title: "Dispute canceled", detail: `${who} canceled their dispute; the share stays ${amt}`, tone: "info" };
  }
}

/* ---------- One list of everything (for the bell and the counts) ---------- */

/** Every alert you have, as plain data. Unread ones are what the bell shows and counts. */
export type AlertItem =
  | { type: "task"; key: string; readKey: string; at: string | null; category: Category; task: Task }
  | { type: "event"; key: string; readKey: string; at: string; category: Category; event: RequestEvent }
  | { type: "contact"; key: string; readKey: string; at: string; category: Category; contact: ContactRow }
  | { type: "chat"; key: string; readKey: string; at: string; category: Category; message: MessageAlert };

export function allAlerts(input: {
  rows: PaymentRequestRow[] | null;
  extraTasks?: Task[];
  events: RequestEvent[];
  contacts: ContactRow[];
  messages: MessageAlert[];
}): AlertItem[] {
  const items: AlertItem[] = [
    ...[...shareTasks(input.rows), ...(input.rows ? (input.extraTasks ?? []) : [])].map((t): AlertItem => ({
      type: "task",
      key: `task-${t.key}`,
      readKey: t.readKey,
      at: t.at,
      category: t.category,
      task: t,
    })),
    ...input.events.map((e): AlertItem => ({
      type: "event",
      key: `event-${e.id}`,
      readKey: alertKey.payment(e.request_id),
      at: e.created_at,
      category: "payments",
      event: e,
    })),
    ...input.contacts.map((c): AlertItem => ({
      type: "contact",
      key: `contact-${c.user_id}`,
      readKey: alertKey.contact(c.user_id),
      at: c.requested_at,
      category: "general",
      contact: c,
    })),
    ...input.messages.map((m): AlertItem => ({
      type: "chat",
      key: `chat-${m.conversation_id}`,
      readKey: alertKey.chat(m.conversation_id),
      at: m.created_at,
      category: "general",
      message: m,
    })),
  ];
  // Each alert once, newest first.
  return items.filter((a, i) => items.findIndex((x) => x.key === a.key) === i).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

export const alertIsUnread = (a: { readKey: string; at: string | null }, seenAt: string | null, reads: Map<string, string>) =>
  isUnreadAlert(a.readKey, a.at, seenAt, reads);

/* ---------- Payment IDs and search ---------- */

/** A payment request's short ID, e.g. "PR-8F3K2A" (from its database id). */
export const paymentRef = (requestId: string) => `PR-${requestId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** A request in your payment search (my_payment_search). */
export type PaymentSearchRow = PaymentRequestRow & {
  people?: string[];
  codes?: string[];
  pending_count?: number;
  confirmed_count?: number;
};

/** Search groups, in order: pending confirmation, paid, confirmed but not paid yet, then the rest. */
export const SEARCH_GROUPS = ["Pending confirmation", "Paid", "Confirmed, not paid yet", "Disputed", "Waived"] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];

export function searchGroup(r: PaymentSearchRow): SearchGroup {
  if (r.direction === "received") {
    switch (r.my_share_status) {
      case "pending":
        return "Pending confirmation";
      case "settled":
        return "Paid";
      case "confirmed":
      case "marked_paid":
        return "Confirmed, not paid yet";
      case "disputed":
        return "Disputed";
      default:
        return "Waived";
    }
  }
  // Your own request: where it stands overall.
  if (r.status === "settled") return "Paid";
  if ((r.pending_count ?? 0) > 0) return "Pending confirmation";
  if ((r.confirmed_count ?? 0) > 0) return "Confirmed, not paid yet";
  return "Disputed";
}

/** Matches the payment ID (PR-…), a transaction ID (CT-…), the title, group, requester or anyone in it. */
export function matchesSearch(r: PaymentSearchRow, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = [
    paymentRef(r.id),
    r.id,
    r.title,
    r.conversation_name ?? "",
    [r.requester_first_name, r.requester_last_name].filter(Boolean).join(" "),
    ...(r.people ?? []),
    ...(r.codes ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** Search results, ranked by group, then the soonest due date (none last), then newest. */
export function rankSearch(rows: PaymentSearchRow[], query: string) {
  return rows
    .filter((r) => matchesSearch(r, query))
    .sort((a, b) => {
      const g = SEARCH_GROUPS.indexOf(searchGroup(a)) - SEARCH_GROUPS.indexOf(searchGroup(b));
      if (g) return g;
      if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date.localeCompare(b.due_date);
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
}
