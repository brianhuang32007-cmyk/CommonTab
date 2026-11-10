import EmptyRequestPage from "./EmptyRequestPage";

export const metadata = { title: "Payment Details · CommonTab" };

// /group/<chat id>/payments/<request id>: the request's details (coming soon).
export default function Page() {
  return <EmptyRequestPage heading="Payment Details" text="The full details of this payment request will show here soon." />;
}
