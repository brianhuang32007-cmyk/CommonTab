import FileViewer from "./FileViewer";

export const metadata = { title: "Document · CommonTab" };

// /group/<chat id>/documents/<request id>/files/<file id>: one uploaded file in CommonTab's viewer.
export default function Page() {
  return <FileViewer />;
}
