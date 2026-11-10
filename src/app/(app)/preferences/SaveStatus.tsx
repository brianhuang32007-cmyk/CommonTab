export type Status = "idle" | "saving" | "saved" | "error";

// Small "Saving… / Saved / Couldn't save" line for forms that save on change.
export default function SaveStatus({ status }: { status: Status }) {
  return (
    <p aria-live="polite" className="min-h-5 text-[13px]">
      {status === "saving" && <span className="text-muted">Saving…</span>}
      {status === "saved" && <span className="font-semibold text-brand">Saved</span>}
      {status === "error" && <span className="text-warn">Couldn&apos;t save. Please try again.</span>}
    </p>
  );
}
