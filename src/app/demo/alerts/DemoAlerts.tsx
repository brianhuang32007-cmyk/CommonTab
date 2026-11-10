"use client";

import { useEffect, useState } from "react";
import AlertsScreen from "@/app/(app)/notifications/AlertsScreen";
import type { PaymentSearchRow, RequestEvent, Task } from "@/lib/alerts";
import type { ContactRow } from "@/app/(app)/contacts/types";
import type { MessageAlert } from "@/components/app/NotificationsContext";
import { dollars } from "@/app/(app)/group/requests";

// The local Alerts & Reminders demo: the real screen with made-up reminders and updates.
// "Opening" a reminder marks it read (as the real destination page does) without leaving.
// The controls on top try each state: a new task, finishing one, loading, errors.

/** "YYYY-MM-DD", this many days from today (your time zone). */
function day(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function startingTasks(): Task[] {
  return [
    {
      key: "t1",
      readKey: "payment:demo-cabin",
      kind: "confirm",
      category: "payments",
      title: "Cabin weekend",
      group: "Ski Club",
      detail: `Confirm your share: ${dollars(8500)} · Requested by Alex Rivera`,
      due: day(-2),
      cents: 8500,
      at: ago(20),
      href: "/group/demo/payments/demo-cabin",
    },
    {
      key: "t2",
      readKey: "payment:demo-gas",
      kind: "pay",
      category: "payments",
      title: "Gas money",
      group: "Road Trip",
      detail: `Pay your share: ${dollars(2250)} · Requested by Priya Shah`,
      due: day(0),
      cents: 2250,
      at: ago(60 * 26),
      href: "/group/demo/payments/demo-gas/settle",
    },
    {
      key: "t3",
      readKey: "payment:demo-dinner",
      kind: "dispute",
      category: "payments",
      title: "Team dinner",
      group: "Ski Club",
      detail: `Your share is disputed: ${dollars(4000)} · Requested by Alex Rivera`,
      due: day(3),
      cents: 4000,
      at: ago(60 * 50),
      href: "/group/demo/payments/demo-dinner",
    },
    {
      key: "t4",
      readKey: "document:demo-gas-receipt",
      kind: "upload-receipt",
      category: "documents",
      title: "Gas receipt",
      group: "Road Trip",
      detail: "Priya asked you for the receipt for gas",
      due: day(1),
      cents: 0,
      at: ago(45),
      href: "/group/demo/documents/demo-gas-receipt/upload",
    },
    {
      key: "t5",
      readKey: "document:demo-waiver",
      kind: "upload-document",
      category: "documents",
      title: "Signed waiver",
      group: "Ski Club",
      detail: "Alex asked you for a signed waiver",
      due: null,
      cents: 0,
      at: ago(60 * 72),
      href: "/group/demo/documents/demo-waiver/upload",
    },
    {
      key: "t6",
      readKey: "document:demo-hotel",
      kind: "review-document",
      category: "documents",
      title: "Hotel receipt",
      group: "Ski Club",
      detail: "Uploaded by Sam Lee · AI check: matches a hotel receipt",
      due: day(5),
      cents: 0,
      at: ago(10),
      href: "/group/demo/documents/demo-hotel/review",
    },
    {
      key: "t7",
      readKey: "proof:demo-pizza",
      kind: "review-payment",
      category: "payments",
      title: "Pizza night",
      group: "Road Trip",
      detail: `Payment proof from Maya Chen: ${dollars(1800)}`,
      due: null,
      cents: 1800,
      at: ago(60 * 5),
      href: "/group/demo/payments/demo-pizza/review",
    },
  ];
}

function event(
  id: number,
  kind: RequestEvent["kind"],
  minutes: number,
  who: string,
  cents: number,
  extra: Partial<RequestEvent> = {},
): RequestEvent {
  return {
    id,
    request_id: `demo-req-${id}`,
    conversation_id: "demo",
    title: "Cabin weekend",
    conversation_name: "Ski Club",
    conversation_kind: "group",
    kind,
    user_id: `demo-${who}`,
    actor_id: `demo-${who}`,
    user_first_name: who,
    actor_first_name: who,
    amount_cents: cents,
    previous_cents: null,
    created_at: ago(minutes),
    i_am_requester: true,
    ...extra,
  };
}

function startingEvents(): RequestEvent[] {
  return [
    event(1, "paid", 5, "Priya", 8500),
    event(2, "confirmed", 30, "Sam", 8500),
    event(3, "disputed", 90, "Lee", 8500),
    event(4, "amount_changed", 60 * 20, "Maya", 6000, { previous_cents: 8500, title: "Team dinner" }),
    event(5, "paid", 60 * 30, "You", 2250, { i_am_requester: false, title: "Gas money", conversation_name: "Road Trip" }),
    event(6, "dispute_canceled", 60 * 49, "Lee", 4000, { title: "Team dinner" }),
  ];
}

const contactsNow = (): ContactRow[] => [
  {
    user_id: "demo-jamie",
    username: "jamie",
    first_name: "Jamie",
    last_name: "Ortiz",
    avatar_url: null,
    relation: "received",
    starred: false,
    requested_at: ago(15),
    venmo_username: null,
    paypal_username: null,
    zelle_contact: null,
    preferred_handle: null,
    phone: null,
  },
];

const messagesNow = (): MessageAlert[] => [
  {
    conversation_id: "demo-ski",
    kind: "group",
    group_name: "Ski Club",
    picture_path: null,
    picture_url: null,
    avatar_gradient: null,
    unread_count: 3,
    mentions_me: true,
    message_id: "demo-m1",
    preview: "@Jordan can you send the gas receipt?",
    file_count: 0,
    created_at: ago(8),
    sender_id: "demo-priya",
    sender_first_name: "Priya",
    sender_last_name: "Shah",
    sender_username: "priya",
    sender_avatar_url: null,
  },
];

function searchRow(
  id: string,
  title: string,
  group: string,
  direction: "sent" | "received",
  status: PaymentSearchRow["my_share_status"],
  cents: number,
  due: string | null,
  extra: Partial<PaymentSearchRow> = {},
): PaymentSearchRow {
  return {
    id,
    conversation_id: "demo",
    title,
    total_cents: cents * 4,
    due_date: due,
    status: "open",
    created_by: direction === "sent" ? "demo-you" : "demo-alex",
    payee_id: direction === "sent" ? "demo-you" : "demo-alex",
    my_share_cents: direction === "received" ? cents : null,
    my_share_status: direction === "received" ? status : null,
    share_count: 4,
    settled_count: 1,
    outstanding_cents: cents * 3,
    direction,
    conversation_name: group,
    conversation_kind: "group",
    created_at: ago(60 * 24),
    requester_first_name: direction === "sent" ? "Jordan" : "Alex",
    requester_last_name: direction === "sent" ? "Lee" : "Rivera",
    people: ["Alex Rivera", "Priya Shah", "Sam Lee", "Jordan Lee"],
    codes: [],
    pending_count: 0,
    confirmed_count: 0,
    ...extra,
  };
}

function searchRowsNow(): PaymentSearchRow[] {
  return [
    searchRow("a1b2c3d4-0000-0000-0000-000000000001", "Cabin weekend", "Ski Club", "received", "pending", 8500, day(-2)),
    searchRow("b2c3d4e5-0000-0000-0000-000000000002", "Gas money", "Road Trip", "received", "confirmed", 2250, day(0)),
    searchRow("c3d4e5f6-0000-0000-0000-000000000003", "Lift tickets", "Ski Club", "received", "settled", 6000, day(-10), {
      codes: ["CT-9A41B7C2"],
    }),
    searchRow("d4e5f6a7-0000-0000-0000-000000000004", "Team dinner", "Ski Club", "received", "disputed", 4000, day(3)),
    searchRow("e5f6a7b8-0000-0000-0000-000000000005", "Pizza night", "Road Trip", "sent", null, 1800, null, { pending_count: 2 }),
    searchRow("f6a7b8c9-0000-0000-0000-000000000006", "Snacks", "Road Trip", "sent", null, 900, day(6), { confirmed_count: 3 }),
    searchRow("a7b8c9d0-0000-0000-0000-000000000007", "Club t-shirts", "Ski Club", "sent", null, 1500, day(-20), {
      status: "settled",
      codes: ["CT-5D2E8F01", "CT-77AA03BC"],
    }),
  ];
}

export default function DemoAlerts() {
  // The made-up data is built in the browser only (its times are relative to now), so the
  // server and the browser never disagree about "8m ago".
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<RequestEvent[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [messages, setMessages] = useState<MessageAlert[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [reads, setReads] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [markFails, setMarkFails] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [nextId, setNextId] = useState(100);

  const reset = () => {
    setTasks(startingTasks());
    setEvents(startingEvents());
    setContacts(contactsNow());
    setMessages(messagesNow());
    setSeenAt(ago(60 * 24)); // "Mark all as read" was a day ago
    setNow(new Date());
    setReads(new Map());
    setLoading(false);
    setFailed(false);
    setRefreshFailed(false);
    setMarkFails(false);
    setOpened(null);
    setRun((n) => n + 1);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      reset();
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const control = "h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold hover:bg-mist";

  return (
    <main className="min-h-screen bg-mist px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-[880px]">
        <div className="rounded-2xl border border-line bg-butter-strong px-4 py-3">
          <p className="text-sm text-[#5C4A0B]">
            <span className="font-bold">Local demo.</span> Made-up reminders and updates, no sign-in, nothing saved. Buttons don&apos;t
            leave the page: opening a reminder just marks it read, like the real page does.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={control}
              onClick={() => {
                setTasks((t) => [
                  {
                    key: `n${nextId}`,
                    readKey: `document:demo-new-${nextId}`,
                    kind: "upload-receipt",
                    category: "documents",
                    title: "Groceries receipt",
                    group: "Road Trip",
                    detail: "Your upload was rejected (blurry). Upload it again.",
                    due: day(1),
                    cents: 0,
                    at: new Date().toISOString(),
                    href: "/group/demo/documents/new/upload",
                  },
                  ...t,
                ]);
                setNextId((n) => n + 1);
              }}
            >
              New Task Arrives
            </button>
            <button
              type="button"
              className={control}
              disabled={!tasks.some((t) => t.kind === "pay")}
              onClick={() => {
                const pay = tasks.find((t) => t.kind === "pay");
                if (!pay) return;
                setTasks((t) => t.filter((x) => x.key !== pay.key));
                setEvents((e) => [
                  event(nextId, "paid", 0, "You", pay.cents, { i_am_requester: false, title: pay.title, conversation_name: pay.group }),
                  ...e,
                ]);
                setNextId((n) => n + 1);
              }}
            >
              Pay &quot;Gas money&quot;
            </button>
            <button
              type="button"
              className={control}
              onClick={() => {
                setLoading(true);
                setTimeout(() => setLoading(false), 1800);
              }}
            >
              Show Loading
            </button>
            <button type="button" className={control} onClick={() => setFailed(true)}>
              Load Fails
            </button>
            <button type="button" className={control} onClick={() => setRefreshFailed(true)}>
              Refresh Fails
            </button>
            <label className="flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm font-bold">
              <input type="checkbox" checked={markFails} onChange={(e) => setMarkFails(e.target.checked)} />
              Mark all as read fails
            </label>
            <button type="button" className={control} onClick={() => setTasks([])}>
              Clear Tasks
            </button>
            <button type="button" className={`${control} ml-auto`} onClick={reset}>
              Reset Demo
            </button>
          </div>
          {opened && (
            <p className="mt-2 text-[13px] text-[#5C4A0B]">
              Would open <span className="font-mono">{opened}</span> and mark it read.
            </p>
          )}
        </div>

        <h1 className="mt-6 mb-3 text-[28px] font-extrabold tracking-tight">Alerts &amp; Reminders</h1>
        {ready && (
          <AlertsScreen
            key={run}
            data={{
              rows: loading ? null : [],
              extraTasks: tasks,
              events,
              contacts,
              messages,
              seenAt,
              reads,
              failed,
              refreshFailed,
              now,
              search: { rows: ready ? searchRowsNow() : null, failed: false, load: () => {} },
            }}
            viewKey="commontab.demo.alerts.view"
            onRetry={() => {
              setFailed(false);
              setRefreshFailed(false);
              setLoading(true);
              setTimeout(() => setLoading(false), 800);
            }}
            onMarkAll={async () => {
              await new Promise((r) => setTimeout(r, 500));
              if (markFails) return false;
              setSeenAt(new Date().toISOString());
              return true;
            }}
            onAccept={async (id) => {
              setContacts((c) => c.filter((x) => x.user_id !== id));
              return true;
            }}
            onDecline={async (id) => {
              setContacts((c) => c.filter((x) => x.user_id !== id));
              return true;
            }}
            onOpen={(readKey, href) => {
              setReads((r) => new Map(r).set(readKey, new Date().toISOString()));
              if (readKey.startsWith("chat:")) setMessages((m) => m.filter((x) => `chat:${x.conversation_id}` !== readKey));
              setOpened(href);
            }}
          />
        )}
      </div>
    </main>
  );
}
