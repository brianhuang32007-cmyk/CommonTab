import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import LoginForm from "./LoginForm";

export const metadata = { title: "Log in · CommonTab" };

export default function LoginPage() {
  return (
    <AuthCard title="Log in" subtitle="Welcome back.">
      <LoginForm />
      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
        New to CommonTab?{" "}
        <Link href="/#signup" className="font-semibold text-brand hover:text-brand-hover hover:underline">
          Sign up for free
        </Link>
      </p>
    </AuthCard>
  );
}
