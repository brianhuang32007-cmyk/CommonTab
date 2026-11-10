import SheetDraft from "./SheetDraft";

export const metadata = { title: "Build a Spreadsheet · CommonTab" };

// /documents/sheet/<draft id>: one spreadsheet being built.
export default function Page() {
  return <SheetDraft />;
}
