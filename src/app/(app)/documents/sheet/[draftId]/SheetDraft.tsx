"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BoltIcon, ChevronLeftIcon, CloseIcon, LockIcon, PlusIcon, ReceiptIcon } from "@/components/app/icons";
import { useProfile } from "@/components/app/ProfileContext";
import { createClient } from "@/lib/supabase/client";
import { detailsHref, parseCents } from "../../../group/requests";
import { titleOf, type Conversation } from "../../../group/types";
import {
  computeSheet,
  dollars,
  emptySheet,
  fileNameFor,
  saveDraft,
  sheetCsv,
  sheetPdf,
  sheetXlsx,
  SOURCE_LABEL,
  TAB_LABEL,
  type SheetData,
  type SheetItem,
  type SheetPlan,
  type SheetTab,
} from "../../drafting";
import SendPanel from "../../SendPanel";

// Build a Spreadsheet. 1. Pick chats (and dates) and say what you need. 2. CommonTab AI reads
// those chats and shows its plan: what it found and questions about anything unclear. 3. The
// sheet: tabs (Summary, All costs, By person, Receipt items), every row tagged with where it
// came from, rows from messages or photos marked to check. Plain code works out every total.
// Change it with more prompts or by hand (Undo keeps earlier versions). 4. Download, send it
// to a chat, or answer a document request with it.

const EXAMPLES = ["A track record of all trip costs", "Who still owes money, and how much", "Spending by category this semester"];

type State = { status: "loading" } | { status: "error" } | { status: "ready" };
type ApiPlan = { plan?: SheetPlan; records?: SheetData["records"]; chats?: Record<string, string>; error?: string };

export default function SheetDraft() {
  const { draftId } = useParams<{ draftId: string }>();
  const { id: me } = useProfile();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [data, setData] = useState<SheetData>(emptySheet);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "saving" | "failed" | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [instruction, setInstruction] = useState("");
  const [tab, setTab] = useState<SheetTab>("summary");

  useEffect(() => {
    let live = true;
    (async () => {
      const [draft, convos] = await Promise.all([
        supabase.from("drafts").select("kind, title, data").eq("id", draftId).maybeSingle(),
        supabase.rpc("my_conversations"),
      ]);
      if (!live) return;
      if (draft.error) return setState({ status: "error" });
      setChats((convos.data ?? []) as Conversation[]);
      if (draft.data && draft.data.kind === "sheet") setData({ ...emptySheet(), ...(draft.data.data as Partial<SheetData>) });
      setState({ status: "ready" });
    })();
    return () => {
      live = false;
    };
  }, [supabase, draftId]);

  const save = useCallback(
    async (next: SheetData, status: "draft" | "done" = "draft") => {
      setSaved("saving");
      const ok = await saveDraft(supabase, { id: draftId, kind: "sheet", title: next.plan?.title || next.prompt || "Untitled spreadsheet", data: next, status });
      setSaved(ok ? "saved" : "failed");
    },
    [supabase, draftId],
  );
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = (next: SheetData) => {
    setData(next);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => save(next), 800);
  };

  /** Asks the AI for a plan (first time), or for an updated one (answers or a change). */
  async function plan(mode: "new" | "refine", extra?: { instruction?: string; answers?: { question: string; answer: string }[] }) {
    if (!data.conversation_ids.length) return setProblem("Pick at least one chat.");
    if (!data.prompt.trim()) return setProblem("Say what the spreadsheet is for.");
    setBusy(mode === "new" ? "CommonTab AI is reading your chats…" : "Updating the spreadsheet…");
    setProblem(null);
    const res = await fetch("/api/ai/sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_ids: data.conversation_ids,
        since: data.since,
        until: data.until,
        prompt: data.prompt.trim(),
        items: mode === "refine" ? data.plan?.items : undefined,
        instruction: extra?.instruction,
        answers: extra?.answers,
      }),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as ApiPlan) : {};
    setBusy(null);
    if (!res?.ok || !body.plan) return setProblem(body.error ?? "Couldn't build it right now. Try again.");
    const history = data.plan ? [...data.history, { at: new Date().toISOString(), label: extra?.instruction ?? (extra?.answers ? "Answered questions" : "Earlier plan"), items: data.plan.items }].slice(-10) : data.history;
    const next: SheetData = {
      ...data,
      stage: mode === "new" ? "plan" : data.stage === "setup" ? "plan" : data.stage,
      plan: body.plan,
      records: body.records ?? data.records,
      chats: body.chats ?? data.chats,
      history,
    };
    setAnswers({});
    setInstruction("");
    commit(next);
  }

  /** Change rows by hand (kept in Undo when it's a removal). */
  const setItems = (items: SheetItem[], label?: string) => {
    if (!data.plan) return;
    const history = label ? [...data.history, { at: new Date().toISOString(), label, items: data.plan.items }].slice(-10) : data.history;
    commit({ ...data, plan: { ...data.plan, items }, history });
  };
  const undo = () => {
    const last = data.history[data.history.length - 1];
    if (!last || !data.plan) return;
    commit({ ...data, plan: { ...data.plan, items: last.items }, history: data.history.slice(0, -1) });
  };

  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Loading…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">Couldn&apos;t open this draft</p>
        <p className="mt-1.5 text-sm text-muted">Check your connection and try again.</p>
        <Link href="/documents" className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
          Back to Document Drafting
        </Link>
      </div>
    );
  }

  const c = computeSheet(data);
  const p = data.plan;
  const tabs = (p?.tabs ?? ["summary", "costs"]).filter((t) => t !== "receipt_items" || c.receiptItems.length > 0);
  const answered = Object.entries(answers).filter(([, v]) => v.trim());

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/documents" className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
          <ChevronLeftIcon className="h-4 w-4" />
          Document Drafting
        </Link>
        <span role="status" className="text-[13px] text-muted">
          {saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : saved === "failed" ? "Couldn't save. Keep this page open." : ""}
        </span>
      </div>

      <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
        <div className="flex items-start gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
            <ReceiptIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Build a Spreadsheet</p>
            {p ? (
              <input
                value={p.title}
                onChange={(e) => commit({ ...data, plan: { ...p, title: e.target.value.slice(0, 120) } })}
                aria-label="Spreadsheet title"
                className="w-full rounded-lg bg-transparent text-[26px] font-extrabold tracking-tight outline-none focus:bg-mist"
              />
            ) : (
              <h2 className="text-[26px] font-extrabold tracking-tight">What do you need?</h2>
            )}
            {p?.note && <p className="mt-1 text-sm text-muted">{p.note}</p>}
          </div>
        </div>
      </section>

      {busy && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-tint px-4 py-3 text-sm font-bold text-brand">
          <BoltIcon className="h-4 w-4" />
          {busy}
        </p>
      )}
      {problem && (
        <p role="alert" className="rounded-2xl bg-butter px-4 py-3 text-sm font-semibold text-honey">
          {problem}
        </p>
      )}

      {/* 1. Setup */}
      {data.stage === "setup" && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <p className="text-sm font-bold">Which chats?</p>
          <p className="text-[13px] text-muted">CommonTab reads their payment requests, receipts, messages, photos and accepted documents. Only what you can already see.</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {chats.map((ch) => {
              const on = data.conversation_ids.includes(ch.id);
              return (
                <li key={ch.id}>
                  <label className={`flex min-h-12 items-center gap-3 rounded-xl border px-3 ${on ? "border-brand bg-tint" : "border-line bg-white"}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setData((d) => ({
                          ...d,
                          conversation_ids: on ? d.conversation_ids.filter((x) => x !== ch.id) : [...d.conversation_ids, ch.id].slice(0, 10),
                        }))
                      }
                      className="h-5 w-5 accent-[#2E6A45]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">
                      {titleOf(ch, me)}
                      {ch.kind === "dm" && <span className="font-medium text-muted"> · direct message</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">
                From <span className="font-medium text-muted">· Optional</span>
              </span>
              <input type="date" value={data.since ?? ""} onChange={(e) => setData((d) => ({ ...d, since: e.target.value || null }))} className="h-12 rounded-xl border border-line px-3" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">
                To <span className="font-medium text-muted">· Optional</span>
              </span>
              <input type="date" value={data.until ?? ""} onChange={(e) => setData((d) => ({ ...d, until: e.target.value || null }))} className="h-12 rounded-xl border border-line px-3" />
            </label>
          </div>
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-sm font-bold">What should it show?</span>
            <textarea
              value={data.prompt}
              onChange={(e) => setData((d) => ({ ...d, prompt: e.target.value.slice(0, 1000) }))}
              rows={3}
              placeholder="e.g. A track record of all costs for the ski trip, by category, and who still owes"
              className="w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setData((d) => ({ ...d, prompt: ex }))} className="min-h-10 rounded-full border border-line bg-white px-3.5 text-sm font-bold text-ink hover:bg-tint">
                {ex}
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <button type="button" disabled={Boolean(busy)} onClick={() => plan("new")} className="flex h-12 items-center gap-2 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              <BoltIcon className="h-4 w-4" />
              Make a Plan
            </button>
          </div>
        </section>
      )}

      {/* 2. Plan */}
      {data.stage === "plan" && p && (
        <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
          <h3 className="text-lg font-extrabold">The plan</h3>
          <p className="mt-1 text-sm text-ink">
            Found {p.items.length} {p.items.length === 1 ? "cost" : "costs"}: {sourceCounts(p.items)}. Tabs: {tabs.map((t) => TAB_LABEL[t]).join(", ")}.
          </p>
          {c.toCheck > 0 && <p className="mt-1 text-[13px] text-muted">{c.toCheck} came from messages or photos and are marked to check.</p>}
          {p.questions.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-sm font-bold">A few questions</p>
              {p.questions.map((q) => (
                <label key={q.id} className="flex flex-col gap-1.5 rounded-2xl bg-mist p-3">
                  <span className="text-sm text-ink">{q.question}</span>
                  <div className="flex flex-wrap gap-2">
                    {["Yes", "No"].map((a) => (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={answers[q.id] === a}
                        onClick={() => setAnswers((x) => ({ ...x, [q.id]: a }))}
                        className={`h-10 rounded-full border px-4 text-sm font-bold ${answers[q.id] === a ? "border-brand bg-brand text-white" : "border-line bg-white"}`}
                      >
                        {a}
                      </button>
                    ))}
                    <input
                      value={answers[q.id] && !["Yes", "No"].includes(answers[q.id]) ? answers[q.id] : ""}
                      onChange={(e) => setAnswers((x) => ({ ...x, [q.id]: e.target.value.slice(0, 300) }))}
                      placeholder="Or type an answer"
                      className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm"
                    />
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => commit({ ...data, stage: "setup" })} className="h-12 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist">
              Change the Request
            </button>
            {answered.length > 0 && (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => plan("refine", { answers: answered.map(([id, a]) => ({ question: p.questions.find((q) => q.id === id)?.question ?? id, answer: a })) })}
                className="h-12 rounded-xl border border-brand bg-white px-4 text-sm font-bold text-brand hover:bg-tint disabled:opacity-60"
              >
                Update with My Answers
              </button>
            )}
            <button type="button" disabled={Boolean(busy)} onClick={() => commit({ ...data, stage: "sheet" })} className="h-12 rounded-xl bg-brand px-5 font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              Build Spreadsheet
            </button>
          </div>
        </section>
      )}

      {/* 3. The sheet */}
      {data.stage === "sheet" && p && (
        <>
          <section className="rounded-3xl border border-line bg-white p-4 sm:p-5">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Tabs">
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-11 rounded-xl px-4 text-sm font-bold ${tab === t ? "bg-tint text-brand" : "text-ink hover:bg-mist"}`}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="mt-3">
              {tab === "summary" && <Summary c={c} />}
              {tab === "costs" && <Costs data={data} onItems={setItems} />}
              {tab === "people" && <People c={c} />}
              {tab === "receipt_items" && <ReceiptItems c={c} />}
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-white p-6 sm:p-7">
            <h3 className="text-lg font-extrabold">Change something</h3>
            <p className="mt-0.5 text-sm text-muted">Ask CommonTab AI, or edit the All costs tab yourself. Totals always update.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value.slice(0, 1000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && instruction.trim()) plan("refine", { instruction: instruction.trim() });
                }}
                placeholder="e.g. Only October. Put the Costco run under Food."
                className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 text-base outline-none focus:border-brand"
              />
              <button
                type="button"
                disabled={Boolean(busy) || !instruction.trim()}
                onClick={() => plan("refine", { instruction: instruction.trim() })}
                className="flex h-12 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                <BoltIcon className="h-4 w-4" />
                Update
              </button>
              <button
                type="button"
                disabled={!data.history.length}
                onClick={undo}
                title={data.history.length ? `Undo: ${data.history[data.history.length - 1].label}` : undefined}
                className="h-12 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist disabled:opacity-40"
              >
                Undo
              </button>
            </div>
          </section>

          <SendPanel
            title={p.title || "the spreadsheet"}
            defaultChatId={data.conversation_ids[0] ?? null}
            formats={[
              { id: "xlsx", label: "Excel (.xlsx), with formulas" },
              { id: "csv", label: "CSV" },
              { id: "pdf", label: "PDF" },
            ]}
            makeFile={async (format) => {
              const name = fileNameFor(p.title, format);
              if (format === "csv") return new File([sheetCsv(data)], name, { type: "text/csv" });
              if (format === "pdf") return new File([(await sheetPdf(data)) as BlobPart], name, { type: "application/pdf" });
              return new File([await sheetXlsx(data)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            }}
            onSent={() => save(data, "done")}
          />
        </>
      )}
    </div>
  );
}

function sourceCounts(items: SheetItem[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(SOURCE_LABEL[i.source_type], (counts.get(SOURCE_LABEL[i.source_type]) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${n} from ${k.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ") || "none";
}

type Computed = ReturnType<typeof computeSheet>;

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "brand" | "honey" }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="text-[11px] font-bold tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${tone === "brand" ? "text-brand" : tone === "honey" ? "text-honey" : "text-ink"}`}>{value}</p>
    </div>
  );
}

function Summary({ c }: { c: Computed }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total costs" value={dollars(c.total)} />
        <Stat label="Collected" value={dollars(c.collected)} tone="brand" />
        <Stat label="Still owed" value={dollars(c.outstanding)} tone={c.outstanding ? "honey" : "ink"} />
      </div>
      {c.toCheck > 0 && (
        <p className="rounded-2xl bg-butter px-4 py-3 text-sm text-honey">
          <span className="font-bold">{c.toCheck} to check:</span> costs read from messages or photos. Confirm them on the All costs tab.
        </p>
      )}
      <div>
        <p className="text-sm font-bold">By category</p>
        <ul className="mt-2 flex flex-col">
          {c.categories.map(([name, cents]) => (
            <li key={name} className="flex items-center gap-3 border-b border-[#EEF1EA] py-2 last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <span className="text-sm font-bold">{dollars(cents)}</span>
              <span className="w-12 text-right text-[13px] text-muted">{c.total ? Math.round((cents / c.total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function sourceHref(i: SheetItem) {
  if (i.source_type === "payment_request" && i.conversation_id && i.source_id) return detailsHref(i.conversation_id, i.source_id);
  if (i.conversation_id) return `/group?chat=${i.conversation_id}`;
  return null;
}

function Costs({ data, onItems }: { data: SheetData; onItems: (items: SheetItem[], label?: string) => void }) {
  const items = data.plan?.items ?? [];
  const change = (key: string, patch: Partial<SheetItem>) => onItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const c = computeSheet(data);
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead className="bg-tint text-left text-[12px] font-bold text-ink">
            <tr>
              <th className="px-2 py-2">In</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Title</th>
              <th className="px-2 py-2">Vendor</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2 text-right">Amount</th>
              <th className="px-2 py-2">Paid by</th>
              <th className="px-2 py-2">Source</th>
              <th className="px-2 py-2" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const locked = i.source_type === "payment_request";
              const href = sourceHref(i);
              return (
                <tr key={i.key} className={`border-t border-line align-top ${i.include ? "" : "opacity-50"} ${i.needs_check && i.include ? "bg-butter/60" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={i.include} onChange={(e) => change(i.key, { include: e.target.checked })} aria-label={`Include ${i.title}`} className="mt-2.5 h-5 w-5 accent-[#2E6A45]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="date" value={i.date ?? ""} disabled={locked} onChange={(e) => change(i.key, { date: e.target.value || null })} className="h-10 w-[140px] rounded-lg border border-line bg-white px-2 disabled:bg-mist" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={i.title} onChange={(e) => change(i.key, { title: e.target.value.slice(0, 160) })} className="h-10 w-full min-w-[160px] rounded-lg border border-line bg-white px-2" />
                    {i.note && <p className="mt-1 text-[12px] text-muted">{i.note}</p>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={i.vendor ?? ""} onChange={(e) => change(i.key, { vendor: e.target.value.slice(0, 120) || null })} className="h-10 w-[120px] rounded-lg border border-line bg-white px-2" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      list="sheet-categories"
                      value={i.category}
                      onChange={(e) => change(i.key, { category: e.target.value.slice(0, 40) })}
                      className="h-10 w-[120px] rounded-lg border border-line bg-white px-2"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {locked ? (
                      <span className="inline-flex h-10 items-center gap-1 font-bold" title="From the payment request; it can't be edited here">
                        <LockIcon className="h-3.5 w-3.5 text-muted" />
                        {dollars(i.amount_cents)}
                      </span>
                    ) : (
                      <AmountInput cents={i.amount_cents} onChange={(amount_cents) => change(i.key, { amount_cents })} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input value={i.paid_by ?? ""} onChange={(e) => change(i.key, { paid_by: e.target.value.slice(0, 80) || null })} className="h-10 w-[120px] rounded-lg border border-line bg-white px-2" />
                  </td>
                  <td className="px-2 py-1.5">
                    {href ? (
                      <Link href={href} className="inline-flex min-h-10 items-center text-[13px] font-bold text-brand hover:underline">
                        {SOURCE_LABEL[i.source_type]}
                      </Link>
                    ) : (
                      <span className="inline-flex min-h-10 items-center text-[13px] text-muted">{SOURCE_LABEL[i.source_type]}</span>
                    )}
                    {i.needs_check && (
                      <button type="button" onClick={() => change(i.key, { needs_check: false })} className="block h-8 rounded-lg bg-white px-2 text-[12px] font-bold whitespace-nowrap text-honey ring-1 ring-[#E0C266]">
                        Check this · Confirm
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => onItems(items.filter((x) => x.key !== i.key), `Removed ${i.title}`)}
                      aria-label={`Remove ${i.title}`}
                      className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-mist hover:text-ink"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-mist font-bold">
              <td colSpan={5} className="px-2 py-2 text-right">
                Total
              </td>
              <td className="px-2 py-2 text-right">{dollars(c.total)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
        <datalist id="sheet-categories">
          {["Lodging", "Food", "Gas", "Transport", "Supplies", "Tickets", "Fees", "Other"].map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
      </div>
      <div>
        <button
          type="button"
          onClick={() =>
            onItems([
              ...items,
              {
                key: `manual_${crypto.randomUUID().slice(0, 8)}`,
                source_type: "manual",
                source_id: null,
                conversation_id: null,
                date: null,
                title: "New cost",
                vendor: null,
                category: "Other",
                amount_cents: 0,
                paid_by: null,
                include: true,
                needs_check: false,
                note: null,
              },
            ])
          }
          className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-mist"
        >
          <PlusIcon className="h-4 w-4" />
          Add Row
        </button>
      </div>
    </div>
  );
}

/** Dollars typed by hand become whole cents (plain code). */
function AmountInput({ cents, onChange }: { cents: number; onChange: (c: number) => void }) {
  const [text, setText] = useState((cents / 100).toFixed(2));
  return (
    <span className="inline-flex h-10 w-[110px] items-center rounded-lg border border-line bg-white px-2">
      <span className="text-muted">$</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseCents(text);
          if (v !== null) {
            onChange(v);
            setText((v / 100).toFixed(2));
          } else setText((cents / 100).toFixed(2));
        }}
        className="min-w-0 flex-1 bg-transparent text-right outline-none"
        aria-label="Amount in dollars"
      />
    </span>
  );
}

function People({ c }: { c: Computed }) {
  if (!c.people.length) return <p className="rounded-2xl bg-mist px-4 py-6 text-center text-sm text-muted">No one is in these payment requests yet.</p>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="bg-tint text-left text-[12px] font-bold">
          <tr>
            <th className="px-3 py-2">Person</th>
            <th className="px-3 py-2 text-right">Owed</th>
            <th className="px-3 py-2 text-right">Paid</th>
            <th className="px-3 py-2 text-right">Still owes</th>
            <th className="px-3 py-2 text-right">Paid out of pocket</th>
          </tr>
        </thead>
        <tbody>
          {c.people.map((p) => (
            <tr key={p.name} className="border-t border-line">
              <td className="px-3 py-2 font-bold">{p.name}</td>
              <td className="px-3 py-2 text-right">{dollars(p.owed)}</td>
              <td className="px-3 py-2 text-right text-brand">{dollars(p.paid)}</td>
              <td className={`px-3 py-2 text-right font-bold ${p.owed - p.paid ? "text-honey" : ""}`}>{dollars(p.owed - p.paid)}</td>
              <td className="px-3 py-2 text-right">{dollars(p.outOfPocket)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptItems({ c }: { c: Computed }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead className="bg-tint text-left text-[12px] font-bold">
          <tr>
            <th className="px-3 py-2">Request</th>
            <th className="px-3 py-2">Vendor</th>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {c.receiptItems.map((r, i) => (
            <tr key={i} className="border-t border-line">
              <td className="px-3 py-2">{r.request}</td>
              <td className="px-3 py-2">{r.vendor ?? ""}</td>
              <td className="px-3 py-2">{r.name}</td>
              <td className="px-3 py-2 text-right">{dollars(r.amount_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
