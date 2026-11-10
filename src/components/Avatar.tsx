// Profile or group picture. Without one, the person's initials on a soft color.
// The color comes from `seed` (their user id), so it looks random but never changes.

// Soft background + dark text pairs (all pass 4.5:1 contrast).
const COLORS: [bg: string, fg: string][] = [
  ["#CDE7D3", "#1F4D33"], // mint
  ["#FBF0C9", "#5C4A0B"], // butter
  ["#D9E4EE", "#23425E"], // sky
  ["#EBDDE6", "#5E2A47"], // rose
  ["#F3F6E2", "#4A6418"], // lime
  ["#F8E1CF", "#6B3510"], // peach
  ["#E2DDF1", "#3D3170"], // lavender
  ["#D5EBE6", "#1D4F47"], // teal
];

// Groups without a picture: soft two-color gradients, each with dark text that passes 4.5:1
// on both ends. The group's index (0–7) is picked at random when it's created.
export const GROUP_GRADIENTS: [from: string, to: string, fg: string][] = [
  ["#CDE7D3", "#D9E4EE", "#1F4D33"], // mint → sky
  ["#FBF0C9", "#F8E1CF", "#5C4A0B"], // butter → peach
  ["#F3F6E2", "#CDE7D3", "#1F4D33"], // lime → mint
  ["#D9E4EE", "#E2DDF1", "#23425E"], // sky → lavender
  ["#EBDDE6", "#F8E1CF", "#5E2A47"], // rose → peach
  ["#D5EBE6", "#F3F6E2", "#1D4F47"], // teal → lime
  ["#E2DDF1", "#EBDDE6", "#3D3170"], // lavender → rose
  ["#F8E1CF", "#FBF0C9", "#6B3510"], // peach → butter
];

function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** First and last word: "Maya Lee" → "ML", "Brian Zhi Jie Huang" → "BH", "maya" → "M" */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function Avatar({
  src,
  name = "",
  seed,
  size = 40,
  alt = "",
  shape = "circle",
  gradient = null,
}: {
  src?: string | null;
  /** Full name, used for the initials. */
  name?: string;
  /** Picks the color; use the user's id. Falls back to the name. */
  seed?: string | number;
  size?: number;
  alt?: string;
  /** circle for people, square (rounded corners) for groups */
  shape?: "circle" | "square";
  /** Groups: which of GROUP_GRADIENTS to use when there's no picture. */
  gradient?: number | null;
}) {
  const round = shape === "square" ? "rounded-[28%]" : "rounded-full";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- also shows local previews (blob: URLs)
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={`shrink-0 object-cover ${round}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initials = initialsOf(name);
  const grad = gradient != null ? GROUP_GRADIENTS[((gradient % 8) + 8) % 8] : null;
  const [bg, fg] = grad ? [`linear-gradient(135deg, ${grad[0]}, ${grad[1]})`, grad[2]] : colorFor(String(seed ?? name));
  return (
    <span
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={`flex shrink-0 items-center justify-center overflow-hidden font-bold select-none ${round}`}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.36) }}
    >
      {initials || (
        // No name yet (e.g. while filling in the sign-up form): a plain person shape.
        <svg viewBox="0 0 24 24" className="h-[60%] w-[60%] translate-y-[8%]" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="8" r="4.5" />
          <path d="M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z" />
        </svg>
      )}
    </span>
  );
}
