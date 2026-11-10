import DocumentDetails from "./DocumentDetails";

export const metadata = { title: "Document Request · CommonTab" };

// /group/<chat id>/documents/<request id>: everything about one document request.
export default function Page() {
  return <DocumentDetails />;
}
