"use client";

import { useNotifications } from "@/components/app/NotificationsContext";
import { useProfile } from "@/components/app/ProfileContext";
import { greetingFor, useNow } from "@/lib/useNow";
import { useDashboardGroups } from "./DashboardData";

export default function Greeting() {
  const now = useNow();
  const { firstName } = useProfile();
  const groups = useDashboardGroups();
  const { messages, unreadMessages, alerts } = useNotifications();
  const tasks = alerts.filter((a) => a.type === "task").length;

  const count = groups.status === "ready" ? groups.groups.length : null;
  const line =
    count === null
      ? " " // keeps the card's height while loading
      : count === 0
        ? "You're all caught up. Create a group to start your first shared tab."
        : tasks > 0
          ? `${tasks} ${tasks === 1 ? "thing needs" : "things need"} your attention${unreadMessages > 0 ? `, and ${unreadMessages} unread ${unreadMessages === 1 ? "message" : "messages"}` : ""}.`
          : unreadMessages > 0
          ? `You have ${unreadMessages} unread ${unreadMessages === 1 ? "message" : "messages"} in ${messages.length} ${messages.length === 1 ? "chat" : "chats"}.`
          : `You're in ${count} ${count === 1 ? "group" : "groups"} and all caught up.`;

  return (
    <section className="rounded-3xl border border-[#DCE8D5] bg-tint px-6 py-6 sm:px-7">
      <h2 className="text-[26px] font-extrabold tracking-tight text-ink">
        {greetingFor(now)}, {firstName}
      </h2>
      <p className="mt-1.5 text-[#3E4A43]">{line}</p>
    </section>
  );
}
