"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  FitWidthIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/components/app/icons";
import { downloadLink, signedLinks } from "@/lib/signedLinks";
import { createClient } from "@/lib/supabase/client";
import { documentHref, fileHref, fileKindLabel, previewKind, type DocFileInfo } from "../../../../../documents";
import { fileSize } from "../../../../../messages";
import { stamp } from "../../../../../requests";

// CommonTab's file viewer for document requests. Only the requester and the person who
// uploaded the file can open it (the database and storage both check). PDFs show page by page
// with page arrows, a page count, zoom and fit to width; photos zoom; Word (.docx), Excel
// (.xlsx) and CSV files are converted into a preview here in the browser. Anything else (an old
// .doc or a slide deck) shows a file card with Download. The file never leaves CommonTab's
// private storage except through a short-lived link.

type State = { status: "loading" } | { status: "missing" } | { status: "error" } | { status: "ready"; file: DocFileInfo; url: string };

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

export default function FileViewer() {
  const { chatId, requestId, fileId } = useParams<{ chatId: string; requestId: string; fileId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ status: "loading" });
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc("document_file_info", { target: fileId });
      if (!live) return;
      if (error) return setState({ status: "error" });
      if (!data) return setState({ status: "missing" });
      const file = data as DocFileInfo;
      const links = await signedLinks(supabase, "request-documents", [file.path]);
      const url = links.get(file.path);
      if (!live) return;
      setState(url ? { status: "ready", file, url } : { status: "missing" });
      // Opened: the requester has now checked this file (needed to accept one that isn't AI Verified).
      if (url) supabase.rpc("mark_document_file_viewed", { target: file.id }).then(() => {});
    })();
    return () => {
      live = false;
    };
  }, [supabase, fileId]);

  const back = documentHref(chatId, requestId);

  if (state.status === "loading") {
    return (
      <p role="status" className="py-10 text-center text-sm text-muted">
        Opening the file…
      </p>
    );
  }
  if (state.status !== "ready") {
    return (
      <div className="mx-auto mt-4 max-w-md rounded-3xl border border-line bg-white p-6 text-center">
        <p className="text-lg font-extrabold">{state.status === "error" ? "Couldn't open this file" : "This file isn't available"}</p>
        <p className="mt-1.5 text-sm text-muted">
          {state.status === "error"
            ? "Check your connection and try again."
            : "Only the person who asked for it and the person who sent it can open it."}
        </p>
        <Link href={back} className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover">
          Back to the request
        </Link>
      </div>
    );
  }

  const { file, url } = state;
  const index = file.siblings.findIndex((s) => s.id === file.id);
  const prev = index > 0 ? file.siblings[index - 1] : null;
  const next = index >= 0 && index < file.siblings.length - 1 ? file.siblings[index + 1] : null;
  const uploader = file.uploader ? `${file.uploader.first_name} ${file.uploader.last_name}` : "A former member";

  async function download() {
    setDownloading(true);
    const link = await downloadLink(supabase, "request-documents", file.path, file.name);
    setDownloading(false);
    if (link) window.location.assign(link);
  }

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col pb-10">
      <Link href={back} className="inline-flex h-11 items-center gap-1 self-start text-sm font-bold text-brand">
        <ChevronLeftIcon className="h-4 w-4" />
        Back to {file.request_title}
      </Link>

      <header className="mt-2 flex flex-wrap items-center gap-3 rounded-3xl border border-line bg-white p-4 sm:p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-tint text-brand">
          <FileIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-extrabold">{file.name}</h2>
          <p className="truncate text-[13px] text-muted">
            {fileKindLabel(file)} · {fileSize(file.size_bytes)} · Sent by {uploader} · {stamp(file.uploaded_at)}
          </p>
        </div>
        {file.siblings.length > 1 && (
          <nav aria-label="Files in this upload" className="flex items-center gap-1">
            <FileStep href={prev ? fileHref(chatId, requestId, prev.id) : null} label="Previous file">
              <ChevronLeftIcon className="h-4 w-4" />
            </FileStep>
            <span className="px-1 text-sm font-bold text-ink">
              File {index + 1} of {file.siblings.length}
            </span>
            <FileStep href={next ? fileHref(chatId, requestId, next.id) : null} label="Next file">
              <ChevronRightIcon className="h-4 w-4" />
            </FileStep>
          </nav>
        )}
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className="flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          <DownloadIcon className="h-4 w-4" />
          {downloading ? "Preparing…" : "Download"}
        </button>
      </header>

      <div className="mt-3">
        <FilePreview file={file} url={url} onDownload={download} />
      </div>
    </div>
  );
}

/** The right viewer for a file: PDF pages, a zoomable photo, a Word or spreadsheet preview, text,
 *  or a Download card for anything else. Also used for files sent in chats. */
export function FilePreview({ file, url, onDownload }: { file: { name: string; mime_type: string }; url: string; onDownload: () => void }) {
  const kind = previewKind(file);
  if (kind === "pdf") return <PdfView url={url} />;
  if (kind === "image") return <ImageView url={url} name={file.name} onDownload={onDownload} />;
  if (kind === "word") return <WordView url={url} onDownload={onDownload} />;
  if (kind === "sheet") return <SheetView url={url} csv={file.name.toLowerCase().endsWith(".csv")} onDownload={onDownload} />;
  if (kind === "text") return <TextView url={url} />;
  return <NoPreview text={`There's no preview for this kind of file (${fileKindLabel(file)}).`} onDownload={onDownload} />;
}

function FileStep({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white text-ink";
  if (!href) {
    return (
      <span aria-disabled="true" aria-label={label} className={`${cls} opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={`${cls} hover:bg-mist`}>
      {children}
    </Link>
  );
}

/* ---------- Shared viewer frame and controls ---------- */

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-2">{children}</div>;
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-bold text-ink hover:bg-mist disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Zoom out / percent / zoom in / fit to width. `zoom` null means fit to width. */
function ZoomControls({ zoom, fit, onZoom }: { zoom: number | null; fit: number; onZoom: (z: number | null) => void }) {
  const current = zoom ?? fit;
  const step = (dir: 1 | -1) => {
    const list = dir === 1 ? ZOOMS.filter((z) => z > current + 0.01) : ZOOMS.filter((z) => z < current - 0.01).reverse();
    if (list.length) onZoom(list[0]);
  };
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Zoom">
      <ToolButton label="Zoom out" onClick={() => step(-1)} disabled={current <= ZOOMS[0] + 0.01}>
        <ZoomOutIcon className="h-5 w-5" />
      </ToolButton>
      <span className="w-14 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {Math.round(current * 100)}%
      </span>
      <ToolButton label="Zoom in" onClick={() => step(1)} disabled={current >= ZOOMS[ZOOMS.length - 1] - 0.01}>
        <ZoomInIcon className="h-5 w-5" />
      </ToolButton>
      <ToolButton label="Fit to width" onClick={() => onZoom(null)} disabled={zoom === null}>
        <FitWidthIcon className="h-5 w-5" />
        <span className="hidden sm:inline">Fit width</span>
      </ToolButton>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p role="status" className="py-16 text-center text-sm text-muted">
      {text}
    </p>
  );
}

function NoPreview({ text, onDownload }: { text: string; onDownload: () => void }) {
  return (
    <div className="rounded-3xl border border-line bg-white p-8 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tint text-brand">
        <FileIcon className="h-7 w-7" />
      </span>
      <p className="mt-3 font-extrabold">{text}</p>
      <p className="mt-1 text-sm text-muted">Download it to open it on your device.</p>
      <button
        type="button"
        onClick={onDownload}
        className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white hover:bg-brand-hover"
      >
        <DownloadIcon className="h-4 w-4" />
        Download
      </button>
    </div>
  );
}

/** Measures the viewer's inner width (for fit to width). */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/* ---------- PDF (PDF.js, page by page) ---------- */

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number }; transform?: number[] }) => {
    promise: Promise<void>;
    cancel: () => void;
  };
};

export function PdfView({ url }: { url: string }) {
  const { ref, width } = useWidth();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit to width
  const [baseWidth, setBaseWidth] = useState(0);

  // Load PDF.js only here, in the browser, and open the file.
  useEffect(() => {
    let live = true;
    let opened: PdfDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (!pdfjs.GlobalWorkerOptions.workerPort) {
          pdfjs.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), {
            type: "module",
          });
        }
        opened = (await pdfjs.getDocument({ url }).promise) as unknown as PdfDoc;
        if (live) setDoc(opened);
        else opened.destroy();
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      opened?.destroy();
    };
  }, [url]);

  const pages = doc?.numPages ?? 0;
  const fit = baseWidth && width ? Math.max(0.25, Math.min(3, (width - 2) / baseWidth)) : 1;
  const scale = zoom ?? fit;

  // Draw the current page, sharp on high-density screens.
  useEffect(() => {
    if (!doc || !canvas.current || !width) return;
    let task: { cancel: () => void } | null = null;
    let live = true;
    (async () => {
      const p = await doc.getPage(page);
      if (!live) return;
      const natural = p.getViewport({ scale: 1 });
      setBaseWidth(natural.width);
      const s = zoom ?? Math.max(0.25, Math.min(3, (width - 2) / natural.width));
      const viewport = p.getViewport({ scale: s });
      const ratio = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${Math.floor(viewport.width)}px`;
      c.style.height = `${Math.floor(viewport.height)}px`;
      const job = p.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      task = job;
      await job.promise.catch(() => {});
    })();
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, page, zoom, width]);

  if (failed) return <NoPreview text="This PDF couldn't be shown here." onDownload={() => window.open(url, "_blank", "noopener")} />;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <div className="flex items-center gap-1" role="group" aria-label="Pages">
          <ToolButton label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            <ChevronLeftIcon className="h-5 w-5" />
          </ToolButton>
          <span className="px-1 text-sm font-bold tabular-nums" aria-live="polite">
            {pages ? `Page ${page} of ${pages}` : "Loading…"}
          </span>
          <ToolButton label="Next page" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={!pages || page >= pages}>
            <ChevronRightIcon className="h-5 w-5" />
          </ToolButton>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
        <ZoomControls zoom={zoom} fit={fit} onZoom={setZoom} />
      </Toolbar>
      <div ref={ref} className="overflow-auto rounded-3xl border border-line bg-mist p-0">
        {!doc && <Loading text="Loading the PDF…" />}
        <canvas ref={canvas} className={`mx-auto block bg-white shadow-sm ${doc ? "" : "hidden"}`} aria-label={`Page ${page} of ${pages}`} role="img" />
      </div>
      {pages > 1 && (
        <p className="text-center text-[13px] text-muted">
          Page {page} of {pages} · {Math.round(scale * 100)}%
        </p>
      )}
    </div>
  );
}

/* ---------- Photos ---------- */

function ImageView({ url, name, onDownload }: { url: string; name: string; onDownload: () => void }) {
  const { ref, width } = useWidth();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const fit = natural && width ? Math.min(1, (width - 2) / natural.w) : 1;
  const scale = zoom ?? fit;

  // Some photos (e.g. iPhone HEIC) can't be shown by every browser.
  if (failed) return <NoPreview text="This browser can't show this photo." onDownload={onDownload} />;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <ZoomControls zoom={zoom} fit={fit} onZoom={setZoom} />
      </Toolbar>
      <div ref={ref} className="overflow-auto rounded-3xl border border-line bg-mist">
        {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset */}
        <img
          src={url}
          alt={name}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
          style={natural ? { width: natural.w * scale, height: natural.h * scale, maxWidth: "none" } : undefined}
          className="mx-auto block"
        />
      </div>
    </div>
  );
}

/* ---------- Word (.docx → a page preview) ---------- */

/** Keeps the converted document to plain formatting: no scripts, handlers or unsafe links. */
function cleanHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && !/^(https?:|mailto:|#|data:image\/)/.test(value)) el.removeAttribute(attr.name);
    }
    if (el.tagName === "A") {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  });
  return doc.body.firstElementChild?.innerHTML ?? "";
}

function WordView({ url, onDownload }: { url: string; onDownload: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const { ref, width } = useWidth();
  const PAGE = 816; // a US Letter page at 96 dpi
  const fit = width ? Math.min(1.5, (width - 2) / PAGE) : 1;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [{ default: mammoth }, res] = await Promise.all([import("mammoth"), fetch(url)]);
        if (!res.ok) throw new Error("download failed");
        const result = await mammoth.convertToHtml({ arrayBuffer: await res.arrayBuffer() });
        if (live) setHtml(cleanHtml(result.value));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [url]);

  if (failed) return <NoPreview text="This Word document couldn't be previewed." onDownload={onDownload} />;
  const scale = zoom ?? fit;
  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <ZoomControls zoom={zoom} fit={fit} onZoom={setZoom} />
        <span className="ml-auto pr-2 text-[13px] text-muted">Preview converted from Word. Download for the original layout.</span>
      </Toolbar>
      <div ref={ref} className="overflow-auto rounded-3xl border border-line bg-mist py-4">
        {html === null ? (
          <Loading text="Converting the document…" />
        ) : (
          <div style={{ width: PAGE * scale }} className="mx-auto">
            <div
              style={{ width: PAGE, transform: `scale(${scale})`, transformOrigin: "top left" }}
              className="doc-preview min-h-[1056px] bg-white px-[72px] py-[72px] text-[15px] leading-6 text-ink shadow-sm"
              dangerouslySetInnerHTML={{ __html: html || "<p><em>This document is empty.</em></p>" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Spreadsheets (.xlsx, .csv → tables) ---------- */

type Sheet = { sheet: string; data: (string | number | boolean | Date | null)[][] };

/** A small CSV reader: quoted cells, commas and line breaks inside quotes. */
function parseCsv(text: string): Sheet["data"] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const cellText = (c: Sheet["data"][number][number]) =>
  c === null || c === undefined
    ? ""
    : c instanceof Date
      ? c.toLocaleDateString("en-US")
      : typeof c === "number"
        ? c.toLocaleString("en-US", { maximumFractionDigits: 2 })
        : String(c);

function SheetView({ url, csv, onDownload }: { url: string; csv: boolean; onDownload: () => void }) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("download failed");
        let result: Sheet[];
        if (csv) result = [{ sheet: "Sheet 1", data: parseCsv(await res.text()) }];
        else {
          const { default: readExcelFile } = await import("read-excel-file/universal");
          result = (await readExcelFile(await res.arrayBuffer())) as Sheet[];
        }
        if (live) setSheets(result);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [url, csv]);

  if (failed) return <NoPreview text="This spreadsheet couldn't be previewed." onDownload={onDownload} />;
  if (!sheets) return <Loading text="Reading the spreadsheet…" />;
  const sheet = sheets[active] ?? sheets[0];
  const rows = sheet?.data.slice(0, 2000) ?? [];
  const columns = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const scale = zoom ?? 1;

  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <ZoomControls zoom={zoom} fit={1} onZoom={setZoom} />
        {sheets.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Sheets">
            {sheets.map((s, i) => (
              <button
                key={s.sheet + i}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`h-11 rounded-xl px-3 text-sm font-bold ${i === active ? "bg-tint text-brand" : "text-ink hover:bg-mist"}`}
              >
                {s.sheet}
              </button>
            ))}
          </div>
        )}
      </Toolbar>
      <div className="overflow-auto rounded-3xl border border-line bg-white">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">This sheet is empty.</p>
        ) : (
          <table style={{ fontSize: `${14 * scale}px` }} className="border-collapse">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className={r === 0 ? "bg-tint font-bold" : r % 2 ? "bg-white" : "bg-mist/60"}>
                  <th scope="row" className="sticky left-0 border border-line bg-mist px-2 py-1 text-right text-muted tabular-nums">
                    {r + 1}
                  </th>
                  {Array.from({ length: columns }, (_, c) => (
                    <td key={c} className="max-w-[320px] border border-line px-2.5 py-1 whitespace-pre-wrap text-ink">
                      {cellText(row[c] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {sheet && sheet.data.length > rows.length && (
        <p className="text-center text-[13px] text-muted">Showing the first {rows.length} rows. Download to see all of them.</p>
      )}
    </div>
  );
}

/* ---------- Plain text ---------- */

function TextView({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch(url)
      .then((r) => r.text())
      .then((t) => live && setText(t))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [url]);
  if (text === null) return <Loading text="Loading…" />;
  return (
    <div className="flex flex-col gap-3">
      <Toolbar>
        <ZoomControls zoom={zoom} fit={1} onZoom={setZoom} />
      </Toolbar>
      <pre
        style={{ fontSize: `${14 * (zoom ?? 1)}px` }}
        className="overflow-auto rounded-3xl border border-line bg-white p-6 leading-relaxed whitespace-pre-wrap text-ink"
      >
        {text || "This file is empty."}
      </pre>
    </div>
  );
}
