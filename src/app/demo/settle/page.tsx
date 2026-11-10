import { notFound } from "next/navigation";
import DemoSettle from "./DemoSettle";

export const metadata = { title: "Settle Demo · CommonTab" };

// /demo/settle: a click-through of paying a share, with made-up people and no sign-in.
// Local only: it exists while running `npm run dev` and is "not found" on the live site.
// It never reads or writes the database.
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DemoSettle />;
}
