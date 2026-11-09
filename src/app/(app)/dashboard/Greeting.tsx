"use client";

import { useProfile } from "@/components/app/ProfileContext";
import { greetingFor, useNow } from "@/lib/useNow";

export default function Greeting() {
  const now = useNow();
  const { firstName } = useProfile();
  return (
    <section className="rounded-3xl border border-[#DCE8D5] bg-tint px-6 py-6 sm:px-7">
      <h2 className="text-[26px] font-extrabold tracking-tight text-ink">
        {greetingFor(now)}, {firstName}
      </h2>
      <p className="mt-1.5 text-[#3E4A43]">
        You&apos;re all caught up. Create a group to start your first shared tab.
      </p>
    </section>
  );
}
