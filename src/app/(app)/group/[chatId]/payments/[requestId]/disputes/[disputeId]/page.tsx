import DisputeRoom from "./DisputeRoom";

export const metadata = { title: "Dispute · CommonTab" };

// /group/<chat id>/payments/<request id>/disputes/<dispute id>: one dispute's chat and negotiation.
export default function Page() {
  return <DisputeRoom />;
}
