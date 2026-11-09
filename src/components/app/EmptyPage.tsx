// Placeholder content for pages that are built in later steps.
export default function EmptyPage({ text }: { text: string }) {
  return (
    <section className="rounded-3xl border border-line bg-white px-6 py-16 text-center">
      <p className="font-bold text-ink">Coming soon</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>
    </section>
  );
}
