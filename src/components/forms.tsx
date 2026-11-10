// Shared form pieces, so every form in the app looks and behaves the same.

export const inputClass =
  "h-12 w-full rounded-xl border bg-white px-4 text-ink placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-brand/20";

export const borderFor = (bad?: string | null) =>
  bad ? "border-warn focus:border-warn" : "border-line focus:border-brand";

export const primaryButton =
  "flex h-12 items-center justify-center rounded-xl bg-brand px-5 font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export const secondaryButton =
  "flex h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-brand ring-1 ring-line transition hover:bg-mist disabled:opacity-60";

/** Red asterisk for required fields (screen readers already hear "required" from the input). */
export function Required() {
  return (
    <span className="text-warn" aria-hidden="true">
      *
    </span>
  );
}

/** Form-level error or success message under a form. */
export function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (error) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-warn">
        {error}
      </p>
    );
  }
  if (success) {
    return (
      <p role="status" className="rounded-lg bg-tint px-3 py-2 text-sm font-semibold text-brand">
        {success}
      </p>
    );
  }
  return null;
}

export function HandleField({
  id,
  label,
  prefix,
  placeholder,
  value,
  onChange,
  error,
  logo,
}: {
  id: string;
  label: string;
  prefix?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  logo?: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
        {logo}
        {label} <span className="font-normal text-muted">(optional)</span>
      </label>
      <div
        className={`flex h-12 items-center rounded-xl border bg-white focus-within:ring-2 focus-within:ring-brand/20 ${borderFor(error)}`}
      >
        {prefix && <span className="pl-4 text-muted">{prefix}</span>}
        <input
          id={id}
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`h-full min-w-0 flex-1 rounded-xl bg-transparent pr-4 text-ink placeholder:text-muted/70 focus:outline-none ${prefix ? "pl-1" : "pl-4"}`}
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
