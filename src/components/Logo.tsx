import Image from "next/image";
import Link from "next/link";

// The CommonTab logo for light backgrounds. Links home.
export default function Logo({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <Link href="/" aria-label="CommonTab home">
      <Image
        src="/brand/commontab-logo.svg"
        alt="CommonTab — Social Finance"
        width={927}
        height={172}
        unoptimized
        className={className}
      />
    </Link>
  );
}
