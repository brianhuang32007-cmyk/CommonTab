// Profile picture, or the default green person icon when there isn't one.
export default function Avatar({
  src,
  size = 40,
  alt = "",
}: {
  src?: string | null;
  size?: number;
  alt?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- also shows local previews (blob: URLs)
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" className="h-[70%] w-[70%] translate-y-[12%] text-mint" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="8" r="4.5" />
        <path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" />
      </svg>
    </span>
  );
}
