import RequestForm from "./RequestForm";

export const metadata = { title: "New Request · CommonTab" };

// /group/<chat id>/request/payment and /group/<chat id>/request/document
export default function Page() {
  return <RequestForm />;
}
