"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeftIcon } from "@/components/app/icons";

// A payment request's Details and Settle pages. Left empty for now (Brian, 2026-11-10);
// their contents come in later steps.
export default function EmptyRequestPage({ heading, text }: { heading: string; text: string }) {
  const { chatId } = useParams<{ chatId: string }>();
  return (
    <div className="mx-auto w-full max-w-[720px]">
      <Link href={`/group?chat=${chatId}`} className="inline-flex h-11 items-center gap-1 text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to the chat
      </Link>
      <section className="mt-2 rounded-3xl border border-line bg-white px-6 py-14 text-center">
        <h2 className="text-[26px] font-extrabold tracking-tight">{heading}</h2>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">{text}</p>
      </section>
    </div>
  );
}
