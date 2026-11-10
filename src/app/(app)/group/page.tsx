import { Suspense } from "react";
import GroupView from "./GroupView";

export const metadata = { title: "Group · CommonTab" };

export default function Page() {
  // GroupView reads the address (?chat=…), which Next.js needs inside a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <GroupView />
    </Suspense>
  );
}
