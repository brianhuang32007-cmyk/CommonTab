"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ChatEntry } from "./blocks";

// One conversation with CommonTab AI: sending questions to /api/ai/chat (server only),
// streaming the answer in word by word, and keeping the recent turns for follow-ups.
// AiChatProvider sits in the app frame, so the CommonTab AI page and the dashboard's chat
// window share the same conversation, and it stays while you move between pages.
// Nothing is saved to the database yet; it clears when you reload or close the tab.

export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
/** Photos are shrunk to this size before they're sent; PDFs can't be, so they have a smaller limit. */
const PHOTO_EDGE = 1600;
export const PHOTO_MAX = 10 * 1024 * 1024;
export const PDF_MAX = 3 * 1024 * 1024;
const READ_FILE = "Read this file and tell me what's in it.";
const UNAVAILABLE = "CommonTab AI is unavailable right now. Try again in a moment.";
/** How much of the conversation goes back to the AI with each question. */
const HISTORY = 12;

type Turn = { role: "user" | "assistant"; content: string };
type Assistant = Extract<ChatEntry, { role: "assistant" }>;

/** Checks a picked file before anything is sent. Returns a problem to show, or null. */
export function fileProblem(file: File): string | null {
  if (!FILE_TYPES.includes(file.type)) return "Files must be a JPG, PNG, WebP or PDF.";
  if (file.type === "application/pdf" && file.size > PDF_MAX) return "PDFs must be 3 MB or smaller. Try a photo of the page instead.";
  if (file.size > PHOTO_MAX) return "Photos must be 10 MB or smaller.";
  return null;
}

function useConversation() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [asking, setAsking] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const stop = useRef<AbortController | null>(null);
  const latest = useRef<ChatEntry[]>([]);

  useEffect(() => {
    latest.current = entries;
  }, [entries]);

  // Closing the page stops an answer that's still coming in.
  useEffect(() => () => stop.current?.abort(), []);

  const update = useCallback(
    (id: string, change: Partial<Assistant>) =>
      setEntries((list) => list.map((e) => (e.id === id && e.role === "assistant" ? { ...e, ...change } : e))),
    [],
  );

  /** Asks a question (with an optional photo or PDF, and the group it's about). */
  const send = useCallback(
    async ({ question, file, group }: { question: string; file?: File | null; group?: { id: string; name: string } | null }) => {
      const text = question.trim();
      if ((!text && !file) || stop.current) return;
      const at = new Date().toISOString();
      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: "user",
        text,
        at,
        group: group?.name ?? null,
        file: file?.name ?? null,
        preview: file?.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      };
      const replyId = crypto.randomUUID();

      // The recent conversation (text only, without the app's own notes), then the new question.
      // Earlier files aren't sent again; the AI's earlier answers already describe them.
      const history = latest.current
        .flatMap((e): Turn[] => {
          if (e.role === "user") {
            const said = [e.text, e.file ? `(I attached ${e.file}.)` : ""].filter(Boolean).join(" ");
            return said ? [{ role: "user", content: said }] : [];
          }
          if (e.local || e.state === "error") return [];
          const said = e.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
          return said ? [{ role: "assistant", content: said }] : [];
        })
        .slice(-HISTORY);
      const messages: Turn[] = [...history, { role: "user", content: text || READ_FILE }];
      // The AI needs the conversation to start with a question.
      while (messages.length && messages[0].role !== "user") messages.shift();

      setEntries((list) => [
        ...list,
        userEntry,
        { id: replyId, role: "assistant", blocks: [{ type: "text", text: "" }], at, state: "thinking" },
      ]);
      setAsking(true);
      const controller = new AbortController();
      stop.current = controller;

      try {
        // Photos are shrunk first (receipts stay readable, and the upload stays small).
        const filePart = file ? await prepareFile(file) : null;
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages, groupId: group?.id ?? null, file: filePart }),
          signal: controller.signal,
        });
        const left = res.headers.get("X-AI-Remaining");
        if (left !== null) setRemaining(Number(left));
        if (!res.ok || !res.body) {
          const problem = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? UNAVAILABLE;
          update(replyId, { blocks: [{ type: "text", text: problem }], state: "error" });
          return;
        }

        // Words arrive as they're written.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let said = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          said += decoder.decode(value, { stream: true });
          update(replyId, { blocks: [{ type: "text", text: said }], state: "streaming" });
        }
        said += decoder.decode();
        const final = said.trim();
        update(
          replyId,
          final
            ? { blocks: [{ type: "text", text: final }], state: "done" }
            : { blocks: [{ type: "text", text: UNAVAILABLE }], state: "error" },
        );
      } catch {
        if (!controller.signal.aborted) update(replyId, { blocks: [{ type: "text", text: UNAVAILABLE }], state: "error" });
      } finally {
        setAsking(false);
        stop.current = null;
      }
    },
    [update],
  );

  return { entries, setEntries, asking, remaining, send };
}

type AiChat = ReturnType<typeof useConversation>;
const AiChatContext = createContext<AiChat | null>(null);

/** Holds the one shared conversation. Place it once, in the app frame. */
export function AiChatProvider({ children }: { children: React.ReactNode }) {
  return createElement(AiChatContext.Provider, { value: useConversation() }, children);
}

/** The shared CommonTab AI conversation (same on the AI page and in the chat window). */
export function useAiChat(): AiChat {
  const chat = useContext(AiChatContext);
  if (!chat) throw new Error("useAiChat must be used inside AiChatProvider");
  return chat;
}

/** Turns an attached file into what the AI route expects. Photos are shrunk to at most
 *  1600 px on the longest side (as a JPEG); PDFs are sent as they are (3 MB at most). */
async function prepareFile(file: File): Promise<{ name: string; mediaType: string; data: string }> {
  if (file.type === "application/pdf") return { name: file.name, mediaType: file.type, data: await base64(file) };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the photo.");
  ctx.fillStyle = "#FFFFFF"; // transparent PNGs get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  return { name: file.name, mediaType: "image/jpeg", data: await base64(blob) };
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
