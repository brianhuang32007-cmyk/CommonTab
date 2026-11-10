import EmptyRequestPage from "../EmptyRequestPage";

export const metadata = { title: "Dispute Payment · CommonTab" };

// /group/<chat id>/payments/<request id>/dispute: disputing your share (coming in Step 10).
export default function Page() {
  return <EmptyRequestPage heading="Dispute Payment" text="Disputing your share of this request will happen here soon." />;
}
