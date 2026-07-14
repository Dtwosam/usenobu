/**
 * Trusted Target product URL validation for Action Center.
 * Only HTTPS Target.com URLs that match the locked fingerprint may be opened.
 */
import {
  isTargetComUrl,
  normalizeTargetProductUrl,
} from "../matching/identity.js";

/**
 * Return a safe openable Target product URL, or null to hide the action.
 */
export function resolveTrustedTargetProductUrl(args: {
  fingerprint_url?: string | null;
  purchase_url?: string | null;
}): string | null {
  const candidates = [args.fingerprint_url, args.purchase_url].filter(
    Boolean,
  ) as string[];

  for (const raw of candidates) {
    const trusted = validateTrustedTargetProductUrl(raw);
    if (trusted) return trusted;
  }
  return null;
}

/**
 * HTTPS + Target domain only. Rejects SerpApi, google, and unknown sellers.
 */
export function validateTrustedTargetProductUrl(
  url: string | null | undefined,
): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (!isTargetComUrl(trimmed)) return null;

  // Reject non-product help/search noise as primary product link? Spec allows product URL.
  // Require /p/ path typical of Target product pages when possible; still allow /-/A- style.
  const path = parsed.pathname.toLowerCase();
  if (path.includes("serpapi") || path.includes("google")) return null;

  const host = parsed.hostname.toLowerCase();
  if (host.includes("serpapi") || host.includes("google.")) return null;

  const normalized = normalizeTargetProductUrl(trimmed);
  return normalized ?? `https://www.target.com${path}`;
}

/** Official Target help/contact (reverified 2026-07-14). */
export const TARGET_OFFICIAL_CONTACT_URL =
  "https://www.target.com/help/contact-us";

export function isOfficialTargetContactUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (!isTargetComUrl(url)) return false;
    return (
      u.pathname.startsWith("/help/contact-us") ||
      u.pathname.startsWith("/help/articles") ||
      u.pathname === "/help"
    );
  } catch {
    return false;
  }
}
