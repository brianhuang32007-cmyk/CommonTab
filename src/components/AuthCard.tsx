import Logo from "@/components/Logo";

// Shared layout for the log in / forgot password / reset password pages.
export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10 sm:py-16">
      <Logo />
      <div className="mt-8 w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-line sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}
