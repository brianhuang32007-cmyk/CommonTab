import SettleView from "./SettleView";

export const metadata = { title: "Settle Payment · CommonTab" };

// /group/<chat id>/payments/<request id>/settle: pay your share (demo, no real money).
export default function Page() {
  return <SettleView />;
}
