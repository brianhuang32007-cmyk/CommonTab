import Image from "next/image";
import Link from "next/link";
import SignupCard from "@/components/landing/SignupCard";
import DemoChat from "@/components/landing/DemoChat";
import DemoDashboard from "@/components/landing/DemoDashboard";
import { CommonTabAICard, ReceiptCheckCard } from "@/components/landing/DemoAI";
import { LayersIcon, ScanIcon, ShieldIcon, TagIcon } from "@/components/landing/icons";

const features = [
  {
    icon: TagIcon,
    title: "Tag friends, track every share",
    body: "@mention friends in chat to request their share, then track each one from pending to settled.",
  },
  {
    icon: ScanIcon,
    title: "Scan, check and draft with AI",
    body: "AI reads receipts, checks uploads and drafts requests. You approve before anything is sent.",
  },
  {
    icon: LayersIcon,
    title: "Every payment in one place",
    body: "See what you owe, what you're owed and what's overdue across all your groups.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="relative isolate">
        {/* Fixed-height backdrop: the photo never resizes when the sign-up card changes height */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[760px] overflow-hidden">
          <Image
            src="/images/hero-cabin.jpg"
            alt="Six friends laughing around a table at a lakeside cabin while one shows a bill split on her phone"
            fill
            preload
            sizes="100vw"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-night/60" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-mist" aria-hidden="true" />
        </div>

        <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-6">
          <Link href="/" aria-label="CommonTab home">
            <Image
              src="/brand/commontab-logo-dark.svg"
              alt="CommonTab — Social Finance"
              width={927}
              height={172}
              unoptimized
              className="h-9 w-auto sm:h-11"
            />
          </Link>
        </header>

        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 pb-28 pt-10 text-center sm:px-6 sm:pt-16">
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Shared tabs, settled together.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-white/90 sm:text-xl">
            Split costs with your club, trip or roommates, and see who&apos;s paid.
          </p>
          <div className="mt-10 flex w-full justify-center">
            <SignupCard />
          </div>
        </div>
      </section>

      {/* What is CommonTab? */}
      <section className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <span className="inline-flex items-center gap-2 rounded-full bg-mint/60 px-4 py-1.5 text-sm font-semibold text-brand">
          <LayersIcon className="h-4 w-4" />
          Introducing CommonTab
        </span>
        <h2 className="mt-5 text-3xl font-extrabold tracking-tight text-ink sm:text-5xl">What is CommonTab?</h2>
        <p className="mt-6 text-lg leading-relaxed text-muted">
          One shared record for every group cost: who&apos;s in, each share, the receipt and the
          deadline. Everyone confirms, pays with the app they already use, and the whole group sees
          what&apos;s settled.
        </p>
        <p className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm text-ink ring-1 ring-line">
          <ShieldIcon className="h-4 w-4 shrink-0 text-brand" />
          We never hold your money. Payments go straight between friends.
        </p>
      </section>

      {/* Our Features */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Our Features</h2>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {features.map((f, i) => (
            <li key={f.title} className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-line sm:p-8">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint/60 text-lg font-bold text-brand">
                  {i + 1}
                </span>
                <f.icon className="h-5 w-5 text-brand" />
              </div>
              <h3 className="mt-5 text-xl font-bold text-ink">{f.title}</h3>
              <p className="mt-3 leading-relaxed text-muted">{f.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Demo */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">See it in action</h2>
          <p className="mx-auto mt-3 max-w-2xl text-lg text-muted">Tag it, track it, settle it.</p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <DemoChat />
          <DemoDashboard />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <CommonTabAICard />
          <ReceiptCheckCard />
        </div>
      </section>

      {/* Call to action + footer */}
      <footer className="mt-auto bg-night text-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Start your first shared tab</h2>
          <p className="mt-3 text-white/80">Free for clubs, trips and roommates.</p>
          <a
            href="#signup"
            className="mt-8 rounded-xl bg-white px-6 py-3 font-semibold text-night transition hover:bg-mint"
          >
            Sign up for free
          </a>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl justify-center px-4 py-6 sm:justify-start sm:px-6">
            <Image
              src="/brand/commontab-logo-dark.svg"
              alt="CommonTab — Social Finance"
              width={927}
              height={172}
              unoptimized
              className="h-7 w-auto"
            />
          </div>
        </div>
      </footer>
    </main>
  );
}
