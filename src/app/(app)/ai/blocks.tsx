import Link from "next/link";
import { BoltIcon, CheckIcon, ClockIcon, FileIcon, LinkIcon } from "@/components/app/icons";

// The pieces a CommonTab AI answer is made of: text, a payment summary card, a document
// request card and a "based on" source line. The AI picks pieces; plain code fills in the
// numbers (amounts are whole cents, formatted here, never worked out by the AI).

export type PaymentStatus = "pending" | "confirmed" | "marked_paid" | "settled" | "disputed" | "waived" | "overdue" | "open";

export type Block =
  | { type: "text"; text: string }
  | {
      type: "payment";
      title: string;
      /** Whole cents. */
      amountCents: number;
      amountLabel: string;
      status: PaymentStatus;
      /** ISO date. */
      due: string | null;
      payableTo: string;
      href: string;
    }
  | { type: "document"; title: string; detail: string; href: string }
  | { type: "source"; text: string };

export type ChatEntry =
  | {
      id: string;
      role: "user";
      text: string;
      at: string;
      group: string | null;
      /** Name of the attached photo or PDF, if any. */
      file: string | null;
      /** Small local preview of an attached photo. */
      preview?: string | null;
    }
  | {
      id: string;
      role: "assistant";
      blocks: Block[];
      at: string;
      /** thinking: waiting for the first words; streaming: words arriving. */
      state?: "thinking" | "streaming" | "done" | "error";
      /** A note from the app itself (not the AI), left out of what's sent to the AI. */
      local?: boolean;
    };

const STATUS: Record<PaymentStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-mist text-muted" },
  confirmed: { label: "Confirmed", className: "bg-tint text-brand" },
  marked_paid: { label: "Awaiting approval", className: "bg-butter-strong text-[#5C4A0B]" },
  settled: { label: "Paid", className: "bg-tint text-brand" },
  waived: { label: "Waived", className: "bg-mist text-muted" },
  open: { label: "Open", className: "bg-tint text-brand" },
  // No red for money states: yellow with dark text.
  disputed: { label: "Disputed", className: "bg-butter text-honey" },
  overdue: { label: "Overdue", className: "bg-butter text-honey" },
};

/** "2026-11-13" means that calendar day where you are (not midnight UTC, which could show the day before). */
const dayOnly = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
};

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function AssistantMessage({ blocks, state }: { blocks: Block[]; state?: "thinking" | "streaming" | "done" | "error" }) {
  return (
    <div className="flex gap-3.5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <BoltIcon className="h-5 w-5" />
      </span>
      <div className="flex min-w-0 max-w-[620px] flex-1 flex-col items-start gap-2.5">
        <p className="pt-2.5 font-extrabold">CommonTab AI</p>
        {state === "thinking" ? (
          <p role="status" className="flex items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-[15px] text-muted">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-sage" />
            Thinking…
          </p>
        ) : (
          blocks.map((b, i) => <BlockView key={i} block={b} />)
        )}
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        <p className="rounded-2xl border border-line bg-white px-4 py-3 text-[15px] leading-6 break-words whitespace-pre-wrap text-ink">
          {block.text}
        </p>
      );
    case "payment":
      return <PaymentCard block={block} />;
    case "document":
      return (
        <div className="flex w-full items-center gap-3.5 rounded-2xl border border-line bg-white px-4 py-3.5">
          <FileIcon className="h-7 w-7 shrink-0 text-ink" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{block.title}</span>
            <span className="block truncate text-sm text-muted">{block.detail}</span>
          </span>
          <Link
            href={block.href}
            className="flex h-11 shrink-0 items-center rounded-xl border-2 border-brand px-5 text-sm font-bold text-brand hover:bg-tint"
          >
            View
          </Link>
        </div>
      );
    case "source":
      return (
        <p className="flex items-center gap-1.5 px-1 text-[13px] text-muted">
          <LinkIcon className="h-4 w-4 text-brand" />
          {block.text}
        </p>
      );
  }
}

function PaymentCard({ block }: { block: Extract<Block, { type: "payment" }> }) {
  const status = STATUS[block.status];
  const due = block.due ? dayOnly(block.due).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No due date";
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-line bg-white">
      <p className="bg-tint px-5 py-2.5 text-[11px] font-bold tracking-[0.14em] text-[#3E4A43] uppercase">Payment summary</p>
      <div className="px-5 pt-3.5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-lg font-extrabold">{block.title}</p>
          <span className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${status.className}`}>
            {block.status === "overdue" ? <ClockIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
            {status.label}
          </span>
        </div>
        <p className="mt-1.5 text-[32px] leading-none font-extrabold text-brand">{dollars(block.amountCents)}</p>
        <p className="mt-1.5 text-sm text-muted">{block.amountLabel}</p>
        <dl className="mt-3 text-sm">
          <div className="flex justify-between border-t border-line py-2.5">
            <dt className="text-muted">Due date</dt>
            <dd className="font-semibold">{due}</dd>
          </div>
          <div className="flex justify-between border-t border-line py-2.5">
            <dt className="text-muted">Payable to</dt>
            <dd className="font-semibold">{block.payableTo}</dd>
          </div>
        </dl>
        <Link
          href={block.href}
          className="mt-1 flex h-12 w-full items-center justify-center rounded-xl bg-brand font-bold text-white hover:bg-brand-hover"
        >
          View request
        </Link>
      </div>
    </div>
  );
}
