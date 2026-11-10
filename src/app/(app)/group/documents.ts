// Document requests: shapes from supabase/migrations/20261110220000_document_requests.sql, plus
// the labels, links and file rules the form, card, page and viewer share.

export type DocType = "receipt" | "invoice" | "spending_records" | "form" | "ticket" | "proof_of_payment" | "other";
export type DocStatus = "requested" | "submitted" | "accepted" | "rejected" | "cant_provide";

/** A document request as the signed-in person sees it (document_request_view). */
export type DocumentRequestView = {
  id: string;
  conversation_id: string;
  title: string;
  doc_type: DocType;
  doc_type_other: string | null;
  instructions: string | null;
  /** "YYYY-MM-DD" or null. */
  due_date: string | null;
  status: "open" | "complete" | "cancelled";
  created_by: string | null;
  created_at: string;
  /** Your part, or null if you weren't asked. */
  my_status: DocStatus | null;
  recipients: { user_id: string; status: DocStatus }[];
  recipient_count: number;
  accepted_count: number;
  /** Uploads waiting for the requester's review. */
  waiting_count: number;
};

/** A row in your document lists (my_document_requests). */
export type DocumentRequestRow = DocumentRequestView & {
  direction: "sent" | "received";
  conversation_name: string | null;
  conversation_kind: "group" | "dm";
  requester_first_name: string | null;
  requester_last_name: string | null;
};

export type DocFile = {
  id: string;
  path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  position: number;
  /** You've opened it in the viewer (missing before migration 20261110240000). */
  viewed?: boolean;
};

/** What AI Verify found (the AI reads and suggests; the requester decides). */
export type AiCheckResult = {
  verdict: "matches" | "partial" | "does_not_match" | "unreadable";
  reason: string;
  looks_like: string | null;
  key_details: { label: string; value: string }[];
  summary: string;
  /** The document's important text, as the AI read it. */
  transcript?: string | null;
  /** Files the AI couldn't read (e.g. an old .doc). */
  skipped?: string[];
};

export type DocUpload = {
  id: string;
  user_id: string;
  status: "draft" | "submitted" | "replaced" | "accepted" | "rejected";
  note: string | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  files: DocFile[];
  /** The latest AI Verify result, shown to both the requester and the sender. */
  ai_status?: "verified" | "failed" | null;
  ai_result?: AiCheckResult | null;
  ai_model?: string | null;
  ai_checked_at?: string | null;
  ai_checked_by?: string | null;
};

export type DocEvent = {
  id: number;
  user_id: string;
  actor_id: string | null;
  kind: "submitted" | "accepted" | "rejected" | "cant_provide" | "cancelled";
  first_name: string;
  created_at: string;
  /** A rejection or can't-provide reason (only for the requester and that person). */
  note: string | null;
};

/** Everything on a document request's page (document_request_details). */
export type DocumentDetails = DocumentRequestView & {
  conversation_name: string | null;
  conversation_kind: "group" | "dm";
  creator: { user_id: string; first_name: string; last_name: string; username: string; avatar_url: string | null } | null;
  people: {
    user_id: string;
    first_name: string;
    last_name: string;
    username: string;
    avatar_url: string | null;
    status: DocStatus;
    updated_at: string;
    reason: string | null;
  }[];
  uploads: DocUpload[];
  events: DocEvent[];
};

/** One file, for the viewer page (document_file_info). */
export type DocFileInfo = DocFile & {
  upload_id: string;
  upload_status: DocUpload["status"];
  uploaded_at: string;
  uploader: { user_id: string; first_name: string; last_name: string } | null;
  request_id: string;
  request_title: string;
  conversation_id: string;
  siblings: { id: string; name: string }[];
};

export const DOC_TYPES: { id: DocType; label: string }[] = [
  { id: "receipt", label: "Receipt" },
  { id: "invoice", label: "Invoice" },
  { id: "spending_records", label: "Spending records" },
  { id: "form", label: "Signed form or waiver" },
  { id: "ticket", label: "Ticket or booking" },
  { id: "proof_of_payment", label: "Proof of payment" },
  { id: "other", label: "Other" },
];

export const docTypeLabel = (r: { doc_type: DocType; doc_type_other: string | null }) =>
  r.doc_type === "other" ? (r.doc_type_other ?? "Other") : (DOC_TYPES.find((t) => t.id === r.doc_type)?.label ?? "Document");

/** A document request's short ID, e.g. "DR-4F1A2C" (from its database id). */
export const docRef = (requestId: string) => `DR-${requestId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

export const documentHref = (chatId: string, requestId: string) => `/group/${chatId}/documents/${requestId}`;
export const fileHref = (chatId: string, requestId: string, fileId: string) => `/group/${chatId}/documents/${requestId}/files/${fileId}`;

/** Status chips: no red; rejected is yellow with dark text. */
export const DOC_STATUS: Record<DocStatus, { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-mist text-muted" },
  submitted: { label: "Ready to review", className: "bg-butter-strong text-[#5C4A0B]" },
  accepted: { label: "Accepted", className: "bg-brand text-white" },
  rejected: { label: "Rejected", className: "bg-butter text-honey" },
  cant_provide: { label: "Can't provide", className: "bg-mist text-muted" },
};

/* ---------- Files ---------- */

export const DOC_FILE_MAX = 15 * 1024 * 1024; // 15 MB each
export const DOC_FILES_MAX = 5;
export const NOTE_MAX = 500;
export const REASON_MAX = 300;

/** Allowed types by extension (browsers sometimes leave the type blank, e.g. HEIC or CSV). */
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  rtf: "application/rtf",
  csv: "text/csv",
  txt: "text/plain",
};

/** For the file picker's accept list. */
export const DOC_ACCEPT = Object.keys(TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The type to store a file as, or null if CommonTab doesn't take that kind of file. */
export function docMimeType(file: { name: string; type: string }): string | null {
  const byName = TYPES[extension(file.name)];
  if (byName) return byName;
  return Object.values(TYPES).includes(file.type) ? file.type : null;
}

/** A storage-safe file name ("Spending records (1).pdf" → "1-Spending-records-1.pdf"). */
export function storageName(position: number, name: string) {
  const ext = extension(name);
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${position + 1}-${base || "file"}${ext ? `.${ext}` : ""}`;
}

/** How the viewer shows a file. */
export type PreviewKind = "pdf" | "image" | "word" | "sheet" | "text" | "none";

export function previewKind(f: { mime_type: string; name: string }): PreviewKind {
  const ext = extension(f.name);
  if (f.mime_type === "application/pdf" || ext === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext) || f.mime_type.startsWith("image/")) return "image";
  if (ext === "docx") return "word";
  if (ext === "xlsx" || ext === "csv") return "sheet";
  if (ext === "txt") return "text";
  return "none";
}

/** "PDF", "Word", "Excel"… for file cards. */
export function fileKindLabel(f: { mime_type: string; name: string }) {
  const ext = extension(f.name);
  if (ext === "pdf") return "PDF";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "Word document";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "Spreadsheet";
  if (["ppt", "pptx"].includes(ext)) return "Slides";
  if (previewKind(f) === "image") return "Photo";
  if (ext === "txt") return "Text";
  return "File";
}
