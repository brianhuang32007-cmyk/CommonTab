"use client";

import { useNow } from "@/lib/useNow";

// Large live clock with the full date underneath. Same on every page.
export default function LiveClock({ size = "lg" }: { size?: "lg" | "sm" }) {
  const now = useNow();
  const [time, ampm] = now
    ? now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).split(" ")
    : ["--:--", ""];
  const date = now
    ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : " ";

  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <p className="flex items-baseline gap-1.5 leading-none">
        <time
          dateTime={now?.toISOString()}
          className={`font-extrabold tracking-tighter tabular-nums text-ink ${size === "lg" ? "text-[44px]" : "text-[40px]"}`}
        >
          {time}
        </time>
        <span className={`font-bold tracking-wide text-brand ${size === "lg" ? "text-base" : "text-sm"}`}>{ampm}</span>
      </p>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted sm:text-xs">{date}</p>
    </div>
  );
}
