import SettleView from "./SettleView";

export const metadata = { title: "Pay Your Share · CommonTab" };

// /group/<chat id>/payments/<request id>/settle: pay your share with Venmo, PayPal or Zelle,
// then send proof (I Paid) for the requester to approve.
export default function Page() {
  return <SettleView />;
}
