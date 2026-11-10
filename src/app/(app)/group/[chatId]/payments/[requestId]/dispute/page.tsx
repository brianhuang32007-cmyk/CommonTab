import DisputeForm from "./DisputeForm";

export const metadata = { title: "Dispute Payment · CommonTab" };

// /group/<chat id>/payments/<request id>/dispute: start a dispute on your share.
export default function Page() {
  return <DisputeForm />;
}
