import EmptyRequestPage from "../EmptyRequestPage";

export const metadata = { title: "Settle Payment · CommonTab" };

// /group/<chat id>/payments/<request id>/settle: settling the payment (coming soon).
export default function Page() {
  return <EmptyRequestPage heading="Settle Payment" text="Paying and settling this request will happen here soon." />;
}
