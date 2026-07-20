/**
 * Mask verified account email for UI (never invent a second address field).
 * Example: demo@example.com → d***@example.com
 */
export function maskEmail(email: string): string {
  const raw = String(email || "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 0 || at === raw.length - 1) return "***";
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  if (!domain) return "***";
  const first = local[0] ?? "*";
  return `${first}***@${domain}`;
}

/** Opaque log marker — not reversible to the address in practice for diagnostics. */
export function hashEmailForLog(email: string): string {
  let h = 0;
  const s = String(email || "").toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `e${(h >>> 0).toString(16)}`;
}
