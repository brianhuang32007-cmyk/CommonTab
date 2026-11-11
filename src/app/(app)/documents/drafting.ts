// Document Drafting: shapes saved in a draft (supabase/migrations/20261110260000), the
// spreadsheet math (plain code only; the AI never calculates), and the shared helpers for
// saving drafts, exporting files and sending them to a chat or a document request.

import type { createClient } from "@/lib/supabase/client";
import { storageName } from "../group/documents";
import { uploadChatFile, uploadFile } from "../group/messages";

type Client = ReturnType<typeof createClient>;

/* ---------- Drafts ---------- */

export type DraftRow = {
  id: string;
  kind: "form" | "sheet";
  title: string;
  status: "draft" | "done";
  source_name: string | null;
  updated_at: string;
};

export const formHref = (id: string) => `/documents/form/${id}`;
export const sheetHref = (id: string) => `/documents/sheet/${id}`;

export async function saveDraft(
  supabase: Client,
  d: { id: string; kind: "form" | "sheet"; title: string; data: object; status?: "draft" | "done"; filePath?: string; fileName?: string },
) {
  const { error } = await supabase.rpc("save_draft", {
    draft_id: d.id,
    draft_kind: d.kind,
    draft_title: d.title,
    draft_data: d.data,
    draft_status: d.status ?? "draft",
    file_path: d.filePath ?? null,
    file_name: d.fileName ?? null,
  });
  return !error;
}

/* ---------- Forms ---------- */

export type FieldType = "text" | "textarea" | "date" | "number" | "email" | "phone" | "checkbox" | "choice" | "signature";

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  options: string[] | null;
  required: boolean;
  section: string | null;
  help: string | null;
  /** The matching fillable field in the original PDF, if it has one. */
  pdf_field: string | null;
  /** A general name for remembering the answer, e.g. "emergency_contact_phone". */
  key: string;
};

export type FormData = {
  stage: "upload" | "fill" | "done";
  /** The chat it's for (used to pre-fill), or null. */
  conversation_id: string | null;
  file_kind: "pdf" | "word" | "image" | null;
  title: string;
  instructions: string | null;
  fields: FormField[];
  /** field id → answer. Checkbox "true"/"false"; signature "typed:Name" or "drawn:data:image/png…". */
  answers: Record<string, string>;
  /** field id → where its pre-filled answer came from ("Your profile", "Remembered answer"…). */
  sources: Record<string, string>;
  /** The original PDF has fillable fields, so the answers go straight into it. */
  fillable: boolean;
  remember: boolean;
};

export const emptyForm = (): FormData => ({
  stage: "upload",
  conversation_id: null,
  file_kind: null,
  title: "",
  instructions: null,
  fields: [],
  answers: {},
  sources: {},
  fillable: false,
  remember: true,
});

/** Fields with an answer, and required fields still empty. */
export function formProgress(f: FormData) {
  const answered = f.fields.filter((x) => isAnswered(x, f.answers[x.id]));
  const missing = f.fields.filter((x) => x.required && !isAnswered(x, f.answers[x.id]));
  return { answered: answered.length, total: f.fields.length, missing };
}
const isAnswered = (field: FormField, v: string | undefined) => (field.type === "checkbox" ? v === "true" || v === "false" : Boolean(v?.trim()));

/** Plain text a PDF's standard font can draw (anything else becomes "?"). */
const pdfText = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");

function answerText(field: FormField, v: string | undefined) {
  if (!v) return "";
  if (field.type === "checkbox") return v === "true" ? "Yes" : "No";
  if (field.type === "signature") return v.startsWith("typed:") ? v.slice(6) : "";
  if (field.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }
  return v;
}

/** The finished form as a PDF: the original with its fields filled in when it has fillable
 *  fields; otherwise a clean new PDF of every question and answer (with the signature). */
export async function buildFormPdf(f: FormData, original: ArrayBuffer | null): Promise<Uint8Array> {
  const lib = await import("pdf-lib");
  const { PDFDocument, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } = lib;

  if (f.fillable && original) {
    const doc = await PDFDocument.load(original, { ignoreEncryption: true });
    const form = doc.getForm();
    const leftover: FormField[] = [];
    for (const field of f.fields) {
      const value = f.answers[field.id];
      if (!field.pdf_field) {
        if (value) leftover.push(field);
        continue;
      }
      try {
        const pf = form.getField(field.pdf_field);
        if (field.type === "signature" && value?.startsWith("drawn:")) {
          // Draw the signature over the field's box.
          const png = await doc.embedPng(value.slice(6));
          const widget = pf.acroField.getWidgets()[0];
          const rect = widget?.getRectangle();
          const page = doc.getPages().find((p) => p.ref === widget?.P()) ?? doc.getPages()[0];
          if (rect) {
            const scale = Math.min(rect.width / png.width, rect.height / png.height);
            page.drawImage(png, { x: rect.x, y: rect.y, width: png.width * scale, height: png.height * scale });
          }
          continue;
        }
        if (pf instanceof PDFTextField) pf.setText(pdfText(answerText(field, value)));
        else if (pf instanceof PDFCheckBox) {
          if (value === "true") pf.check();
          else pf.uncheck();
        } else if (pf instanceof PDFDropdown || pf instanceof PDFOptionList) {
          if (value && pf.getOptions().includes(value)) pf.select(value);
        } else if (pf instanceof PDFRadioGroup) {
          if (value && pf.getOptions().includes(value)) pf.select(value);
        } else if (value) leftover.push(field);
      } catch {
        if (value) leftover.push(field);
      }
    }
    try {
      form.flatten();
    } catch {}
    if (leftover.length) await appendAnswers(doc, "Additional answers", leftover, f);
    return doc.save();
  }

  const doc = await PDFDocument.create();
  await appendAnswers(doc, f.title || "Form", f.fields, f, f.instructions);
  return doc.save();

  async function appendAnswers(
    pdf: Awaited<ReturnType<typeof PDFDocument.create>>,
    heading: string,
    fields: FormField[],
    data: FormData,
    intro?: string | null,
  ) {
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const W = 612;
    const H = 792;
    const M = 56;
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const ink = rgb(0.09, 0.13, 0.11);
    const muted = rgb(0.36, 0.4, 0.38);

    const newPage = () => {
      page = pdf.addPage([W, H]);
      y = H - M;
    };
    const wrap = (text: string, size: number, f2: typeof font, width: number) => {
      const lines: string[] = [];
      for (const para of pdfText(text).split("\n")) {
        let line = "";
        for (const word of para.split(/\s+/)) {
          const next = line ? `${line} ${word}` : word;
          if (f2.widthOfTextAtSize(next, size) > width && line) {
            lines.push(line);
            line = word;
          } else line = next;
        }
        lines.push(line);
      }
      return lines;
    };
    const write = (text: string, size: number, f2: typeof font, color = ink, gap = 4) => {
      for (const line of wrap(text, size, f2, W - 2 * M)) {
        if (y < M + size) newPage();
        page.drawText(line, { x: M, y: y - size, size, font: f2, color });
        y -= size + gap;
      }
    };

    write(heading, 18, bold, ink, 8);
    if (intro) write(intro, 10, font, muted, 3);
    y -= 8;
    let section: string | null = null;
    for (const field of fields) {
      if (field.section && field.section !== section) {
        section = field.section;
        y -= 6;
        write(section.toUpperCase(), 9, bold, muted, 6);
      }
      write(field.label, 10, bold, ink, 3);
      const value = data.answers[field.id];
      if (field.type === "signature" && value?.startsWith("drawn:")) {
        const png = await pdf.embedPng(value.slice(6));
        const h = 48;
        const w = (png.width / png.height) * h;
        if (y < M + h + 10) newPage();
        page.drawImage(png, { x: M, y: y - h, width: w, height: h });
        y -= h + 10;
      } else {
        const text = answerText(field, value) || "-";
        write(text, 11, field.type === "signature" ? italic : font, ink, 4);
      }
      y -= 6;
    }
  }
}

/* ---------- Spreadsheets ---------- */

export type SourceType = "payment_request" | "message" | "attachment" | "document" | "manual";

export type SheetItem = {
  key: string;
  source_type: SourceType;
  source_id: string | null;
  conversation_id: string | null;
  /** "YYYY-MM-DD" or null. */
  date: string | null;
  title: string;
  vendor: string | null;
  category: string;
  amount_cents: number;
  paid_by: string | null;
  include: boolean;
  /** Read from a message or a photo: check it before trusting it. */
  needs_check: boolean;
  note: string | null;
};

export type SheetTab = "summary" | "costs" | "people" | "receipt_items";
export const TAB_LABEL: Record<SheetTab, string> = {
  summary: "Summary",
  costs: "All costs",
  people: "By person",
  receipt_items: "Receipt items",
};

/** What a payment request looked like when the sheet was built (for By person and receipts). */
export type SheetRecord = {
  id: string;
  conversation_id: string;
  title: string;
  total_cents: number;
  shares: { user_id: string; name: string; amount_cents: number; status: string }[];
  receipt: { vendor: string | null; items: { name: string; amount_cents: number }[] } | null;
};

export type SheetPlan = {
  title: string;
  note: string;
  tabs: SheetTab[];
  items: SheetItem[];
  questions: { id: string; question: string; item_key: string | null }[];
};

export type SheetData = {
  stage: "setup" | "plan" | "sheet";
  conversation_ids: string[];
  since: string | null;
  until: string | null;
  prompt: string;
  plan: SheetPlan | null;
  /** Payment requests behind the sheet (from the database, never from the AI). */
  records: SheetRecord[];
  /** chat id → name, for source labels. */
  chats: Record<string, string>;
  /** Earlier versions of the rows, newest last (for Undo). */
  history: { at: string; label: string; items: SheetItem[] }[];
};

export const emptySheet = (): SheetData => ({
  stage: "setup",
  conversation_ids: [],
  since: null,
  until: null,
  prompt: "",
  plan: null,
  records: [],
  chats: {},
  history: [],
});

export const dollars = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Everything the tabs show, worked out in plain code from the rows and the records. */
export function computeSheet(data: SheetData) {
  const items = (data.plan?.items ?? []).filter((i) => i.include);
  const total = items.reduce((a, i) => a + i.amount_cents, 0);

  const categories = new Map<string, number>();
  for (const i of items) categories.set(i.category || "Other", (categories.get(i.category || "Other") ?? 0) + i.amount_cents);

  const records = new Map(data.records.map((r) => [r.id, r]));
  const included = items.filter((i) => i.source_type === "payment_request" && i.source_id && records.has(i.source_id));
  const people = new Map<string, { name: string; owed: number; paid: number; outOfPocket: number }>();
  const person = (name: string) => {
    const key = name.trim() || "Unknown";
    if (!people.has(key)) people.set(key, { name: key, owed: 0, paid: 0, outOfPocket: 0 });
    return people.get(key)!;
  };
  let collected = 0;
  let outstanding = 0;
  for (const i of included) {
    for (const s of records.get(i.source_id!)!.shares) {
      if (s.status === "waived") continue;
      const p = person(s.name);
      p.owed += s.amount_cents;
      if (s.status === "settled") {
        p.paid += s.amount_cents;
        collected += s.amount_cents;
      } else outstanding += s.amount_cents;
    }
  }
  for (const i of items) if (i.source_type !== "payment_request" && i.paid_by) person(i.paid_by).outOfPocket += i.amount_cents;

  const receiptItems = included.flatMap((i) => {
    const r = records.get(i.source_id!)!;
    return (r.receipt?.items ?? []).map((it) => ({ request: r.title, vendor: r.receipt?.vendor ?? null, name: it.name, amount_cents: it.amount_cents }));
  });

  return {
    items,
    total,
    categories: [...categories.entries()].sort((a, b) => b[1] - a[1]),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    collected,
    outstanding,
    receiptItems,
    toCheck: items.filter((i) => i.needs_check).length,
  };
}

export const SOURCE_LABEL: Record<SourceType, string> = {
  payment_request: "Payment request",
  message: "Chat message",
  attachment: "Photo or PDF in chat",
  document: "Accepted document",
  manual: "Added by you",
};

const money = (cents: number) => Math.round(cents) / 100;
const MONEY = "[$$-409]#,##0.00";

/** The spreadsheet as an Excel file, with real formulas for every total (so anyone can check them). */
export async function sheetXlsx(data: SheetData): Promise<Blob> {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const c = computeSheet(data);
  const tabs = data.plan?.tabs ?? ["summary", "costs", "people"];
  const head = (labels: string[]) => labels.map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#E8F2E4" }));
  type Cell = Record<string, unknown> | null;
  const n = c.items.length;
  // Each formula also carries its value (worked out here in plain code), so the file shows the
  // right numbers anywhere: CommonTab's viewer, phone previews, Excel or Google Sheets.
  const cached = new Map<string, number>();
  const formula = (text: string, cents: number, extra: Record<string, unknown> = {}) => {
    cached.set(text, money(cents));
    return { value: text, type: "Formula", format: MONEY, ...extra };
  };
  const costRows: Cell[][] = [
    head(["Date", "Title", "Vendor", "Category", "Amount", "Paid by", "Source", "Check"]),
    ...c.items.map((i) => [
      i.date ? { value: i.date, type: String } : null,
      { value: i.title, type: String },
      i.vendor ? { value: i.vendor, type: String } : null,
      { value: i.category || "Other", type: String },
      { value: money(i.amount_cents), type: Number, format: MONEY },
      i.paid_by ? { value: i.paid_by, type: String } : null,
      { value: SOURCE_LABEL[i.source_type], type: String },
      i.needs_check ? { value: "Check this", type: String } : null,
    ]),
    [null, { value: "Total", type: String, fontWeight: "bold" }, null, null, formula(`SUM(E2:E${n + 1})`, c.total, { fontWeight: "bold" }), null, null, null],
  ];
  const sheets: { data: Cell[][]; sheet: string; columns?: { width: number }[]; stickyRowsCount?: number }[] = [];
  if (tabs.includes("summary")) {
    sheets.push({
      sheet: "Summary",
      columns: [{ width: 28 }, { width: 16 }],
      data: [
        head([data.plan?.title || "Spreadsheet", ""]),
        [{ value: "Total costs", type: String }, formula(`'All costs'!E${n + 2}`, c.total)],
        [{ value: "Collected", type: String }, { value: money(c.collected), type: Number, format: MONEY }],
        [{ value: "Still owed", type: String }, { value: money(c.outstanding), type: Number, format: MONEY }],
        [null, null],
        head(["Category", "Amount"]),
        ...c.categories.map(([name, cents]) => [
          { value: name, type: String },
          formula(`SUMIF('All costs'!D2:D${n + 1},"${name.replace(/"/g, '""')}",'All costs'!E2:E${n + 1})`, cents),
        ]),
      ],
    });
  }
  sheets.push({ sheet: "All costs", data: costRows, stickyRowsCount: 1, columns: [{ width: 12 }, { width: 32 }, { width: 20 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 22 }, { width: 12 }] });
  if (tabs.includes("people")) {
    sheets.push({
      sheet: "By person",
      stickyRowsCount: 1,
      columns: [{ width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }],
      data: [
        head(["Person", "Owed", "Paid", "Still owes", "Paid out of pocket"]),
        ...c.people.map((p, idx) => [
          { value: p.name, type: String },
          { value: money(p.owed), type: Number, format: MONEY },
          { value: money(p.paid), type: Number, format: MONEY },
          formula(`B${idx + 2}-C${idx + 2}`, p.owed - p.paid),
          { value: money(p.outOfPocket), type: Number, format: MONEY },
        ]),
      ],
    });
  }
  if (tabs.includes("receipt_items") && c.receiptItems.length) {
    sheets.push({
      sheet: "Receipt items",
      stickyRowsCount: 1,
      columns: [{ width: 28 }, { width: 20 }, { width: 32 }, { width: 14 }],
      data: [
        head(["Request", "Vendor", "Item", "Amount"]),
        ...c.receiptItems.map((r) => [
          { value: r.request, type: String },
          r.vendor ? { value: r.vendor, type: String } : null,
          { value: r.name, type: String },
          { value: money(r.amount_cents), type: Number, format: MONEY },
        ]),
      ],
    });
  }
  // The library's types are strict about cell shapes; these are all valid cells.
  const blob = await (writeExcelFile as unknown as (s: unknown) => { toBlob: () => Promise<Blob> })(sheets).toBlob();
  return withFormulaValues(blob, cached);
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Writes each formula's value into the .xlsx next to the formula, and asks Excel to
 *  recalculate when it opens (so edits there still update the totals). */
async function withFormulaValues(blob: Blob, cached: Map<string, number>): Promise<Blob> {
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  for (const name of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const xml = strFromU8(files[name]).replace(/<f>([^<]*)<\/f>(?:<v>[^<]*<\/v>)?/g, (whole, text: string) => {
        const value = cached.get(unescapeXml(text));
        return value === undefined ? whole : `<f>${text}</f><v>${value}</v>`;
      });
      files[name] = strToU8(xml);
    }
    if (name === "xl/workbook.xml") {
      const xml = strFromU8(files[name]);
      if (!xml.includes("<calcPr")) files[name] = strToU8(xml.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'));
    }
  }
  return new Blob([zipSync(files) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** The All costs tab as CSV. */
export function sheetCsv(data: SheetData) {
  const c = computeSheet(data);
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [
    ["Date", "Title", "Vendor", "Category", "Amount", "Paid by", "Source", "Check"],
    ...c.items.map((i) => [
      i.date ?? "",
      i.title,
      i.vendor ?? "",
      i.category || "Other",
      (i.amount_cents / 100).toFixed(2),
      i.paid_by ?? "",
      SOURCE_LABEL[i.source_type],
      i.needs_check ? "Check this" : "",
    ]),
    ["", "Total", "", "", (c.total / 100).toFixed(2), "", "", ""],
  ];
  return new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" });
}

/** The spreadsheet as a printable PDF (summary, then each tab as a table). */
export async function sheetPdf(data: SheetData): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const c = computeSheet(data);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 792; // landscape letter
  const H = 612;
  const M = 40;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.09, 0.13, 0.11);
  const fit = (s: string, width: number, f: typeof font, size: number) => {
    const full = pdfText(s);
    if (f.widthOfTextAtSize(full, size) <= width) return full;
    let t = full;
    while (t && f.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
    return `${t}...`;
  };
  const row = (cells: string[], widths: number[], f = font, size = 9) => {
    if (y < M + 14) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
    let x = M;
    cells.forEach((cellText, i) => {
      page.drawText(fit(cellText, widths[i] - 6, f, size), { x, y: y - size, size, font: f, color: ink });
      x += widths[i];
    });
    y -= size + 6;
  };
  const title = (t: string) => {
    y -= 6;
    row([t], [W - 2 * M], bold, 14);
    y -= 2;
  };
  title(data.plan?.title || "Spreadsheet");
  row([`Total costs ${dollars(c.total)}   ·   Collected ${dollars(c.collected)}   ·   Still owed ${dollars(c.outstanding)}`], [W - 2 * M], font, 10);
  y -= 6;
  title("All costs");
  const widths = [70, 190, 110, 90, 70, 100, 82];
  row(["Date", "Title", "Vendor", "Category", "Amount", "Paid by", "Check"], widths, bold);
  for (const i of c.items) {
    row([i.date ?? "", i.title, i.vendor ?? "", i.category || "Other", dollars(i.amount_cents), i.paid_by ?? "", i.needs_check ? "Check this" : ""], widths);
  }
  row(["", "Total", "", "", dollars(c.total), "", ""], widths, bold);
  if (c.people.length) {
    title("By person");
    const pw = [200, 110, 110, 110, 130];
    row(["Person", "Owed", "Paid", "Still owes", "Paid out of pocket"], pw, bold);
    for (const p of c.people) row([p.name, dollars(p.owed), dollars(p.paid), dollars(p.owed - p.paid), dollars(p.outOfPocket)], pw);
  }
  return doc.save();
}

/* ---------- Sending ---------- */

/** A file name safe for storage paths. */
const safe = (name: string) => storageName(0, name).replace(/^1-/, "");

/** Posts a file in a chat as your message (through the same checked send as the composer). */
export async function sendFileToChat(supabase: Client, chatId: string, file: File, body: string) {
  const msgId = crypto.randomUUID();
  const path = `${chatId}/${msgId}/${safe(file.name)}`;
  await uploadChatFile(supabase, path, file, () => {}).promise;
  const { error } = await supabase.rpc("send_message", {
    msg_id: msgId,
    target: chatId,
    msg_body: body,
    mention_ids: [],
    files: [{ path, name: file.name }],
  });
  if (error) throw new Error(error.message);
}

/** Sends a file as your answer to a document request (then it waits for the requester's review). */
export async function submitFileToRequest(supabase: Client, me: string, requestId: string, file: File, note: string | null) {
  const uploadId = crypto.randomUUID();
  const path = `${requestId}/${me}/${uploadId}/${storageName(0, file.name)}`;
  await uploadFile(supabase, "request-documents", path, file, file.type, "15 MB", () => {}).promise;
  const saved = await supabase.rpc("save_document_draft", { upload_id: uploadId, req: requestId, upload_note: note, files: [{ path, name: file.name }] });
  if (saved.error) throw new Error(saved.error.message);
  const sent = await supabase.rpc("submit_document_upload", { target: uploadId });
  if (sent.error) throw new Error(sent.error.message);
}

/** Saves a file to the device. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const fileNameFor = (title: string, ext: string) =>
  `${(title || "CommonTab").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "CommonTab"}.${ext}`;
