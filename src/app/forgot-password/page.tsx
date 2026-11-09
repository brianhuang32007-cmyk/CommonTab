import Link from "next/link";
import AuthCard from "@/components/AuthCard";
import ForgotPasswordForm from "./ForgotPasswordForm";

export const metadata = { title: "Forgot password · CommonTab" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Forgot your password?" subtitle="Enter your email and we'll send you a link to reset it.">
      <ForgotPasswordForm />
      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-brand hover:text-brand-hover hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}
