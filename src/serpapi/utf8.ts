/**
 * Normalize shopping titles that may arrive as mojibake / mis-decoded UTF-8.
 * Does not invent product identity — only repairs character encoding when detectable.
 */
export function decodeShoppingTitle(title: string): string {
  if (!title) return title;
  let out = title;

  // Common UTF-8-as-Windows-1252 / Latin-1 mojibake markers
  const looksMojibake =
    /Ã.|Â.|â.?[€™œ]|â.?�|ï¿½|�|Ã©|Ã¨|Ã |Ã¢|Ã´/.test(out) ||
    out.includes("\uFFFD");

  if (looksMojibake) {
    try {
      const repaired = Buffer.from(out, "latin1").toString("utf8");
      const bad = (s: string) => (s.match(/\uFFFD/g) ?? []).length;
      if (bad(repaired) <= bad(out) && repaired.trim().length > 0) {
        out = repaired;
      }
    } catch {
      // keep original
    }
  }

  // NFC normalize for stable comparison downstream
  try {
    out = out.normalize("NFC");
  } catch {
    // ignore
  }

  return out.trim();
}

export function titleLooksWellFormedUtf8(title: string): boolean {
  if (!title) return false;
  if (title.includes("\uFFFD")) return false;
  if (/Ã.|Â.|â.?�/.test(title)) return false;
  return true;
}
