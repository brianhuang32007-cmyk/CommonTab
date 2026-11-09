import Link from "next/link";
import Logo from "@/components/Logo";

export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <Logo />
      <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-line">
        <h1 className="text-2xl font-bold text-ink">That link didn&apos;t work</h1>
        <p className="mt-3 text-muted">
          It may have expired or already been used. Confirmation links also need to be opened in the
          same browser you signed up in.
        </p>
        <Link
          href="/#signup"
          className="mt-6 inline-flex h-12 items-center rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-hover"
        >
          Back to sign up
        </Link>
      </div>
    </main>
  );
}
