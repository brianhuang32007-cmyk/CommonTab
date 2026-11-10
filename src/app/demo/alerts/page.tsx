import { notFound } from "next/navigation";
import { connection } from "next/server";
import DemoAlerts from "./DemoAlerts";

export const metadata = { title: "Alerts Demo · CommonTab" };
export const instant = false;

// /demo/alerts: Alerts & Reminders with made-up reminders and updates, and no sign-in.
// Local only: it exists while running `npm run dev` and is "not found" on the live site.
// It never reads or writes the database. Rendered per visit: the made-up dates are relative to today.
export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  await connection();
  return <DemoAlerts />;
}
