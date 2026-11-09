"use client";

import { useState } from "react";

// Password field with a Show/Hide toggle.
export default function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "new-password" | "current-password";
  describedBy?: string;
  invalid?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={`h-12 w-full rounded-xl border bg-white px-4 pr-20 text-ink focus:outline-none focus:ring-2 focus:ring-brand/20 ${
          invalid ? "border-warn focus:border-warn" : "border-line focus:border-brand"
        }`}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-2 my-auto h-9 rounded-lg px-3 text-sm font-semibold text-brand hover:bg-mist"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}
