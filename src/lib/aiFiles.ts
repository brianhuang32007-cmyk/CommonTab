// Server-side checks for files sent to the AI routes.

/** Does the file really start like the type it claims? (Stops renamed or fake files.) */
export function looksLike(mediaType: string, base64: string) {
  const head = Buffer.from(base64.slice(0, 24), "base64");
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  switch (mediaType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47);
    case "image/webp":
      return head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return head.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return false;
  }
}
