/**
 * Deterministic identity normalization for matching.
 * Does not invent TCIN from SerpApi product_id.
 */

/** Normalize model / SKU-like strings for exact compare. */
export function normalizeModel(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[-_]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

/** Normalize UPC/GTIN to digits only. */
export function normalizeUpc(value: string | undefined | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/** Normalize free-text variant attributes. */
export function normalizeVariant(value: string | undefined | null): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extract Target TCIN from a Target.com product URL when present.
 * Patterns: /-/A-12345678 or A-12345678 query segments.
 */
export function extractTcinFromTargetUrl(
  url: string | undefined | null,
): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      host !== "target.com" &&
      host !== "www.target.com" &&
      !host.endsWith(".target.com")
    ) {
      return null;
    }
    const fromPath = u.pathname.match(/\/A-(\d{5,12})(?:\/|$)/i);
    if (fromPath?.[1]) return fromPath[1];
    const fromSearch = u.search.match(/(?:^|[?&])(?:tcin|A)=(\d{5,12})/i);
    if (fromSearch?.[1]) return fromSearch[1];
  } catch {
    // fall through
  }
  const loose = url.match(/\/A-(\d{5,12})(?:\b|\/|$)/i);
  return loose?.[1] ?? null;
}

export function isTargetComUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "target.com" ||
      host === "www.target.com" ||
      host.endsWith(".target.com")
    );
  } catch {
    return false;
  }
}

/** Normalize Target product URL for equality (host + path without trailing slash). */
export function normalizeTargetProductUrl(
  url: string | undefined | null,
): string | null {
  if (!url || !isTargetComUrl(url)) return null;
  try {
    const u = new URL(url);
    u.hash = "";
    // Drop tracking params; keep path identity
    u.search = "";
    let path = u.pathname.replace(/\/+$/, "");
    path = path.toLowerCase();
    return `https://www.target.com${path}`;
  } catch {
    return null;
  }
}

export function tokenizeTitle(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s&]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Jaccard token overlap in [0,1]. Title-only signals never confirm a match. */
export function titleSimilarity(a: string, b: string): number {
  const ta = tokenizeTitle(a);
  const tb = tokenizeTitle(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter += 1;
  }
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}
