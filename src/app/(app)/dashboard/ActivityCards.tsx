"use client";

import Link from "next/link";
import Avatar from "@/components/Avatar";
import { CheckIcon } from "@/components/app/icons";
import { useNotifications, type MessageAlert } from "@/components/app/NotificationsContext";
import { useNow } from "@/lib/useNow";

// "Recent activity" (chats with new messages) and "Needs your attention" (mentions of you),
// from the same live alerts as the bell. Payments and requests join these once they exist.

const sender = (a: MessageAlert) => (a.sender_first_name ? `${a.sender_first_name} ${a.sender_last_name}` : "Former member");

function preview(a: MessageAlert) {
  return a.preview || (a.file_count ? `Sent ${a.file_count === 1 ? "a file" : `${a.file_count} files`}` : "New message");
}

function ago(iso: string, now: Date | null) {
  if (!now) return "";
  const s = (now.getTime() - Date.parse(iso)) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function AlertRow({ a, now, mention }: { a: MessageAlert; now: Date | null; mention?: boolean }) {
  const isGroup = a.kind === "group";
  return (
    <li className="border-b border-[#EEF1EA] last:border-b-0">
      <Link href={`/group?chat=${a.conversation_id}`} className="flex items-start gap-3 rounded-2xl px-2 py-3 hover:bg-mist">
        {isGroup ? (
          <Avatar
            src={a.picture_url}
            name={a.group_name ?? "Group"}
            seed={a.conversation_id}
            size={40}
            shape="square"
            gradient={a.avatar_gradient}
          />
        ) : (
          <Avatar src={a.sender_avatar_url} name={sender(a)} seed={a.sender_id ?? a.conversation_id} size={40} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink">
            <span className="font-bold">{sender(a)}</span>
            {mention ? " mentioned you" : isGroup ? " wrote" : " sent you a message"}
            {isGroup && (
              <>
                {" "}
                in <span className="font-bold">{a.group_name}</span>
              </>
            )}
          </span>
          <span className="mt-0.5 block truncate text-sm text-[#3E4A43]">{preview(a)}</span>
          <span className="mt-0.5 block text-xs text-muted">
            {a.unread_count} new {a.unread_count === 1 ? "message" : "messages"}
            {now && ` · ${ago(a.created_at, now)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function RecentActivity() {
  const { messages } = useNotifications();
  const now = useNow();
  return (
    <section className="rounded-3xl border border-line bg-white px-6 py-5">
      <h2 className="text-xl font-extrabold text-ink">Recent activity</h2>
      {messages.length ? (
        <ul className="mt-3 border-t border-[#EEF1EA] pt-1">
          {messages.slice(0, 6).map((a) => (
            <AlertRow key={a.conversation_id} a={a} now={now} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-[#EEF1EA] pt-4 text-sm text-muted">
          No new messages. New messages, payments and requests from your groups will show up here.
        </p>
      )}
    </section>
  );
}

export function NeedsAttention() {
  const { messages } = useNotifications();
  const now = useNow();
  const mentions = messages.filter((m) => m.mentions_me);
  return (
    <section className="min-w-0 flex-[1_1_300px] rounded-3xl border border-line bg-white p-6">
      <h2 className="text-xl font-extrabold text-ink">Needs your attention</h2>
      {mentions.length ? (
        <ul className="mt-3">
          {mentions.map((a) => (
            <AlertRow key={a.conversation_id} a={a} now={now} mention />
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-tint p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand">
            <CheckIcon className="h-5 w-5" />
          </span>
          <p className="text-sm text-ink">
            <span className="font-bold">You&apos;re all set.</span> Mentions of you, shares to confirm, payments due and requested documents
            will appear here.
          </p>
        </div>
      )}
    </section>
  );
}
