import AlertsView from "./AlertsView";

export const metadata = { title: "Alerts & Reminders · CommonTab" };

// /notifications: Alerts & Reminders (tasks that need you, and recent updates).
export default function Page() {
  return <AlertsView />;
}
