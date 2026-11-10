import RequestDetails from "./RequestDetails";

export const metadata = { title: "Payment Details · CommonTab" };

// /group/<chat id>/payments/<request id>: everything about one payment request.
export default function Page() {
  return <RequestDetails />;
}
