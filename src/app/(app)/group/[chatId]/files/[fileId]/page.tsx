import ChatFileViewer from "./ChatFileViewer";

export const metadata = { title: "File · CommonTab" };

// /group/<chat id>/files/<file id>: a file sent in a chat, in CommonTab's viewer.
export default function Page() {
  return <ChatFileViewer />;
}
