import { tool } from "ai";
import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { docTasks, paymentRef, shareTasks, TASK, type PaymentSearchRow } from "@/lib/alerts";
import type { Block } from "@/app/(app)/ai/blocks";
import { DOC_STATUS, docRef, docTypeLabel, documentHref, type DocumentDetails, type DocumentRequestRow, type DocumentRequestView } from "@/app/(app)/group/documents";
import {
  deadlineLabel,
  detailsHref,
  dollars,
  SHARE_STATUS,
  todayIso,
  type PaymentProof,
  type PaymentRequestDetails,
  type PaymentRequestRow,
  type PaymentRequestView,
} from "@/app/(app)/group/requests";

// CommonTab AI's read-only view of the signed-in person's own account: payments, document
// requests, accepted documents, what needs them, their profile and their drafts. Every lookup
// uses their own session, so the database's rules decide what they (and so the AI) can see.
// All money is added up here in plain code, never by the AI. show_cards lets the AI put
// payment and document request cards under its answer; the cards are filled in here from the
// database, so the AI can't invent an amount.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Chat = { id: string; kind: "group" | "dm"; name: string | null; members: { user_id: string; first_name: string; last_name: string }[] };

const OPEN_SHARE = new Set(["pending", "confirmed", "marked_paid", "disputed"]);

/** Requests the AI looked at this turn (title → id), so cards can follow the ones it names. */
export type Seen = Map<string, { kind: "payment" | "document"; id: string }>;

export function accountTools(supabase: Supabase, me: string, email: string | null, chats: Chat[], cards: Block[], seen: Seen) {
  const see = (kind: "payment" | "document", id: string, title: string) => {
    if (title.trim().length >= 3 && !seen.has(title.trim().toLowerCase())) seen.set(title.trim().toLowerCase(), { kind, id });
  };
  const nameOf = (id: string | null | undefined) => {
    if (!id) return "a former member";
    if (id === me) return "you";
    for (const c of chats) {
      const m = c.members.find((x) => x.user_id === id);
      if (m) return `${m.first_name} ${m.last_name}`;
    }
    return "someone";
  };
  const chatName = (id: string) => {
    const c = chats.find((x) => x.id === id);
    if (!c) return "a chat";
    if (c.kind === "group") return c.name ?? "Group";
    const other = c.members.find((m) => m.user_id !== me);
    return other ? `DM with ${other.first_name} ${other.last_name}` : "a direct message";
  };

  /** One payment request, as the AI sees it (amounts as dollars text, worked out here). */
  const describePayment = (r: PaymentSearchRow | PaymentRequestRow) => {
    see("payment", r.id, r.title);
    const iRequested = r.direction === "sent";
    const shares = (r.shares ?? []).filter((s) => s.user_id !== r.payee_id);
    const unpaid = shares.filter((s) => OPEN_SHARE.has(s.status ?? ""));
    return {
      request_id: r.id,
      payment_id: paymentRef(r.id),
      title: r.title,
      chat: r.conversation_name ?? chatName(r.conversation_id),
      requested_by: iRequested ? "you" : nameOf(r.payee_id),
      total: dollars(r.total_cents),
      due_date: r.due_date,
      due: deadlineLabel(r.due_date).text,
      request_status: r.status === "settled" ? "fully paid" : r.status,
      ...(iRequested
        ? {
            you_are: "the requester (being paid)",
            still_owed_to_you: dollars(unpaid.reduce((a, s) => a + s.amount_cents, 0)),
            people: shares.map((s) => ({ name: nameOf(s.user_id), amount: dollars(s.amount_cents), status: s.status ? SHARE_STATUS[s.status].label : null })),
          }
        : r.my_share_cents !== null
          ? {
              you_are: "paying",
              your_share: dollars(r.my_share_cents),
              your_status: r.my_share_status ? SHARE_STATUS[r.my_share_status].label : null,
            }
          : { you_are: "not in this request" }),
    };
  };

  /** Fills payment and document request cards from the database (never from the AI). */
  async function addCards(payment_request_ids: string[], document_request_ids: string[]) {
        const [payments, documents] = await Promise.all([
          Promise.all(payment_request_ids.map((id) => supabase.rpc("payment_request_view", { req: id }))),
          Promise.all(document_request_ids.map((id) => supabase.rpc("document_request_view", { req: id }))),
        ]);
        let shown = 0;
        const today = todayIso();
        for (const { data } of payments) {
          const r = data as PaymentRequestView | null;
          if (!r || cards.some((c) => c.type === "payment" && c.href.endsWith(r.id))) continue;
          const iRequested = r.payee_id === me;
          const unpaid = (r.shares ?? []).filter((s) => s.user_id !== me && OPEN_SHARE.has(s.status ?? ""));
          const paying = !iRequested && r.my_share_cents !== null;
          const overdue = r.status === "open" && r.due_date && r.due_date < today && (paying ? OPEN_SHARE.has(r.my_share_status ?? "") : unpaid.length > 0);
          cards.push({
            type: "payment",
            title: r.title,
            amountCents: iRequested ? unpaid.reduce((a, s) => a + s.amount_cents, 0) : paying ? (r.my_share_cents ?? 0) : r.total_cents,
            amountLabel: iRequested
              ? `Still owed to you · ${r.settled_count} of ${r.share_count} paid · ${chatName(r.conversation_id)}`
              : paying
                ? `Your share of ${dollars(r.total_cents)} · ${chatName(r.conversation_id)}`
                : `Total · ${chatName(r.conversation_id)}`,
            status: r.status === "settled" ? "settled" : overdue ? "overdue" : paying ? (r.my_share_status ?? "pending") : "open",
            due: r.due_date,
            payableTo: iRequested ? "You" : nameOf(r.payee_id),
            href: detailsHref(r.conversation_id, r.id),
          });
          shown++;
        }
        for (const { data } of documents) {
          const d = data as DocumentRequestView | null;
          if (!d || cards.some((c) => c.type === "document" && c.href.endsWith(d.id))) continue;
          const mine = d.created_by === me;
          const where = mine
            ? `${d.accepted_count} of ${d.recipient_count} accepted${d.waiting_count ? ` · ${d.waiting_count} to review` : ""}`
            : d.my_status
              ? `You: ${DOC_STATUS[d.my_status].label}`
              : "You weren't asked";
          cards.push({
            type: "document",
            title: d.title,
            detail: `${docTypeLabel(d)} · ${d.status === "open" ? where : d.status === "complete" ? "Complete" : "Canceled"} · ${deadlineLabel(d.due_date).text}`,
            href: documentHref(d.conversation_id, d.id),
          });
          shown++;
        }
    return shown;
  }

  return {
    tools: {
    my_payments: tool({
      description:
        "Everything about the signed-in person's money in CommonTab: what they owe (and to whom), what they're owed, and every payment request they're part of (open and fully paid) with each person's status. Totals are already added up. Use this for 'what do I owe', 'who owes me', 'did everyone pay for X'.",
      inputSchema: z.object({
        include_fully_paid: z.boolean().default(true).describe("Include requests that are already fully paid"),
      }),
      execute: async ({ include_fully_paid }) => {
        const { data, error } = await supabase.rpc("my_payment_search");
        if (error) return { error: "Couldn't load payments right now." };
        const rows = ((data ?? []) as PaymentSearchRow[]).filter((r) => include_fully_paid || r.status !== "settled");
        const today = todayIso();
        const owing = rows.filter((r) => r.direction === "received" && r.my_share_cents !== null && OPEN_SHARE.has(r.my_share_status ?? ""));
        const owed = rows
          .filter((r) => r.direction === "sent")
          .flatMap((r) => (r.shares ?? []).filter((s) => s.user_id !== me && OPEN_SHARE.has(s.status ?? "")));
        return {
          summary: {
            you_owe: dollars(owing.reduce((a, r) => a + (r.my_share_cents ?? 0), 0)),
            requests_you_owe_on: owing.length,
            overdue_requests_you_owe_on: owing.filter((r) => r.due_date && r.due_date < today).length,
            you_are_owed: dollars(owed.reduce((a, s) => a + s.amount_cents, 0)),
            people_who_owe_you: new Set(owed.map((s) => s.user_id)).size,
            payments_waiting_for_your_approval: owed.filter((s) => s.status === "marked_paid").length,
          },
          requests: rows.slice(0, 60).map(describePayment),
        };
      },
    }),

    payment_details: tool({
      description:
        "Full details of one payment request: who's in it and each person's status, the receipt, its history, and the payment proofs the signed-in person can see (their own, or everyone's if they requested it). request_id comes from my_payments.",
      inputSchema: z.object({ request_id: z.string().uuid() }),
      execute: async ({ request_id }) => {
        const [{ data, error }, proofs] = await Promise.all([
          supabase.rpc("payment_request_details", { req: request_id }),
          supabase.rpc("my_payment_proofs", { req: request_id }),
        ]);
        if (error || !data) return { error: "That request isn't available." };
        const r = data as PaymentRequestDetails;
        see("payment", r.id, r.title);
        return {
          request_id: r.id,
          payment_id: paymentRef(r.id),
          title: r.title,
          chat: r.conversation_name ?? chatName(r.conversation_id),
          total: dollars(r.total_cents),
          due: deadlineLabel(r.due_date).text,
          status: r.status === "settled" ? "fully paid" : r.status,
          requested_by: r.payee ? (r.payee.user_id === me ? "you" : `${r.payee.first_name} ${r.payee.last_name}`) : "a former member",
          people: r.people.map((p) => ({ name: p.user_id === me ? "you" : `${p.first_name} ${p.last_name}`, amount: dollars(p.amount_cents), status: SHARE_STATUS[p.status].label })),
          receipt: r.receipt
            ? { vendor: r.receipt.vendor, date: r.receipt.date, total: r.receipt.total_cents !== null ? dollars(r.receipt.total_cents) : null, items: r.receipt.items.map((i) => `${i.name}: ${dollars(i.amount_cents)}`) }
            : null,
          history: (r.events ?? []).map((e) => ({ what: e.kind.replace(/_/g, " "), who: e.user_id === me ? "you" : e.first_name, amount: e.amount_cents !== null ? dollars(e.amount_cents) : null, when: e.created_at })),
          payment_proofs: ((proofs.data ?? []) as PaymentProof[]).map((p) => ({
            from: p.payer_id === me ? "you" : [p.first_name, p.last_name].filter(Boolean).join(" "),
            amount: dollars(p.amount_cents),
            method: p.method,
            status: p.status,
            rejected_because: p.review_reason,
            ai_check: p.ai_status === "verified" ? "matches what was owed" : p.ai_status === "failed" ? "couldn't confirm it" : "not run",
            sent: p.created_at,
          })),
        };
      },
    }),

    my_document_requests: tool({
      description:
        "The signed-in person's open document requests: ones they asked others for (and how many are waiting for their review) and ones others asked them for (and where theirs stands).",
      inputSchema: z.object({}),
      execute: async () => {
        const { data, error } = await supabase.rpc("my_document_requests");
        if (error) return { error: "Couldn't load document requests right now." };
        return ((data ?? []) as DocumentRequestRow[]).map((d) => (see("document", d.id, d.title), {
          request_id: d.id,
          request_ref: docRef(d.id),
          title: d.title,
          type: docTypeLabel(d),
          chat: d.conversation_name ?? chatName(d.conversation_id),
          due: deadlineLabel(d.due_date).text,
          ...(d.direction === "sent"
            ? { you_are: "the requester", accepted: `${d.accepted_count} of ${d.recipient_count}`, waiting_for_your_review: d.waiting_count }
            : { you_are: "asked to send it", requested_by: [d.requester_first_name, d.requester_last_name].filter(Boolean).join(" "), your_status: d.my_status ? DOC_STATUS[d.my_status].label : null }),
        }));
      },
    }),

    document_request_details: tool({
      description:
        "Details of one document request: who was asked and each status, what was sent (file names, notes) and AI Verify summaries and key details, where the signed-in person may see them. request_id comes from my_document_requests or my_documents.",
      inputSchema: z.object({ request_id: z.string().uuid() }),
      execute: async ({ request_id }) => {
        const { data, error } = await supabase.rpc("document_request_details", { req: request_id });
        if (error || !data) return { error: "That request isn't available." };
        const d = data as DocumentDetails;
        see("document", d.id, d.title);
        return {
          request_id: d.id,
          request_ref: docRef(d.id),
          title: d.title,
          type: docTypeLabel(d),
          instructions: d.instructions,
          status: d.status,
          due: deadlineLabel(d.due_date).text,
          requested_by: d.creator ? (d.creator.user_id === me ? "you" : `${d.creator.first_name} ${d.creator.last_name}`) : "a former member",
          people: d.people.map((p) => ({ name: p.user_id === me ? "you" : `${p.first_name} ${p.last_name}`, status: DOC_STATUS[p.status].label, reason: p.reason })),
          uploads: d.uploads
            .filter((u) => u.status !== "draft")
            .map((u) => ({
              from: u.user_id === me ? "you" : nameOf(u.user_id),
              status: u.status,
              note: u.note,
              files: u.files.map((f) => f.name),
              ai_verify: u.ai_status ?? "not run",
              ai_summary: u.ai_result?.summary ?? null,
              ai_key_details: u.ai_result?.key_details ?? null,
            })),
        };
      },
    }),

    my_documents: tool({
      description:
        "Accepted documents kept in the signed-in person's chats (the Files tabs): what each is, who sent it to whom, when it was accepted, and its AI summary and key details. Only documents they requested or sent.",
      inputSchema: z.object({ chat_id: z.string().uuid().optional().describe("Only this chat; leave out for all chats") }),
      execute: async ({ chat_id }) => {
        const targets = chat_id ? chats.filter((c) => c.id === chat_id) : chats;
        const lists = await Promise.all(targets.slice(0, 25).map((c) => supabase.rpc("my_chat_documents", { target: c.id })));
        type Doc = {
          request_id: string;
          title: string;
          doc_type: DocumentRequestView["doc_type"];
          doc_type_other: string | null;
          conversation_id: string;
          sender: { user_id: string | null; first_name: string | null };
          requester: { user_id: string | null; first_name: string | null };
          accepted_at: string | null;
          ai_status: string | null;
          ai_result: { summary?: string; key_details?: unknown } | null;
          files: { name: string }[];
        };
        return lists.flatMap((l) =>
          ((l.data ?? []) as Doc[]).map((d) => (see("document", d.request_id, d.title), {
            request_id: d.request_id,
            title: d.title,
            type: docTypeLabel(d),
            chat: chatName(d.conversation_id),
            sent_by: d.sender.user_id === me ? "you" : d.sender.first_name,
            requested_by: d.requester.user_id === me ? "you" : d.requester.first_name,
            accepted_at: d.accepted_at,
            files: d.files.map((f) => f.name),
            ai_verified: d.ai_status === "verified",
            summary: d.ai_result?.summary ?? null,
            key_details: d.ai_result?.key_details ?? null,
          })),
        );
      },
    }),

    what_needs_me: tool({
      description:
        "What the signed-in person needs to do now, most urgent first: shares to confirm or pay, payments to approve, documents to upload or review, open disputes.",
      inputSchema: z.object({}),
      execute: async () => {
        const [payments, documents] = await Promise.all([supabase.rpc("my_payment_requests"), supabase.rpc("my_document_requests")]);
        const tasks = [...shareTasks((payments.data ?? []) as PaymentRequestRow[]), ...docTasks((documents.data ?? []) as DocumentRequestRow[])].sort((a, b) =>
          !a.due || !b.due ? (a.due ? -1 : b.due ? 1 : 0) : a.due.localeCompare(b.due),
        );
        return tasks.map((t) => ({ what: TASK[t.kind].status, title: t.title, detail: t.detail, chat: t.group, due: deadlineLabel(t.due).text }));
      },
    }),

    my_account: tool({
      description: "The signed-in person's own account: name, username, email, phone, payment handles (Venmo, PayPal, Zelle), reminder and privacy settings.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase
          .from("profiles")
          .select("username, first_name, last_name, phone, venmo_username, paypal_username, zelle_contact, preferred_handle, remind_3_days, remind_1_day, remind_overdue, discoverable_by, show_phone")
          .eq("id", me)
          .maybeSingle();
        if (!data) return { error: "Couldn't load your account." };
        return {
          name: `${data.first_name} ${data.last_name}`,
          username: `@${data.username}`,
          email,
          phone: data.phone,
          payment_handles: {
            venmo: data.venmo_username ? `@${data.venmo_username}` : "not added",
            paypal: data.paypal_username ? `paypal.me/${data.paypal_username}` : "not added",
            zelle: data.zelle_contact ?? "not added",
            shown_first: data.preferred_handle,
          },
          reminders: { three_days_before: data.remind_3_days, one_day_before: data.remind_1_day, when_overdue: data.remind_overdue },
          who_can_find_you: data.discoverable_by === "groups" ? "only people in shared groups" : "everyone",
          show_phone_to_contacts: data.show_phone,
        };
      },
    }),

    my_drafts: tool({
      description: "The signed-in person's Document Drafting drafts (forms and spreadsheets): titles, type, done or draft, last edited.",
      inputSchema: z.object({}),
      execute: async () => {
        const { data } = await supabase.from("drafts").select("id, kind, title, status, updated_at").order("updated_at", { ascending: false }).limit(30);
        return (data ?? []).map((d) => ({ title: d.title, kind: d.kind === "form" ? "form" : "spreadsheet", status: d.status, edited: d.updated_at, link: `/documents/${d.kind}/${d.id}` }));
      },
    }),

    show_cards: tool({
      description:
        "Show payment request and/or document request cards under your answer, so the person can see the details and tap through. Use it whenever you talk about specific requests (up to 6 of each). Pass ids from the other tools. The cards are filled in from the database.",
      inputSchema: z.object({
        payment_request_ids: z.array(z.string().uuid()).max(6).default([]),
        document_request_ids: z.array(z.string().uuid()).max(6).default([]),
      }),
      execute: async ({ payment_request_ids, document_request_ids }) => ({ shown: await addCards(payment_request_ids, document_request_ids) }),
    }),
  },
    addCards,
  };
}
