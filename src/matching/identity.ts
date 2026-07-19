/**
 * Deterministic identity normalization for matching.
 * Does not invent TCIN from SerpApi product_id.
 */

export type TargetProductUrlParseResult =
  | {
      ok: true;
      original_url: string;
      normalized_url: string;
      tcin: string;
      slug_tokens: string[];
      product_name: string | null;
    }
  | {
      ok: false;
      original_url: string;
      code:
        | "INVALID_TARGET_URL"
        | "UNSUPPORTED_TARGET_URL"
        | "TARGET_IDENTIFIER_MISSING";
      message: string;
    };

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

function extractBoundedSlugTokens(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  const pIndex = parts.findIndex((part) => part.toLowerCase() === "p");
  const slug = pIndex >= 0 ? parts[pIndex + 1] : undefined;
  if (!slug || /^A-\d{5,12}$/i.test(slug)) return [];
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !/^\d+$/.test(part))
    .slice(0, 12);
}

/**
 * Deterministic parser for supported Target product URLs.
 * It performs no network requests and never treats arbitrary URL text as identity.
 */
export function parseTargetProductUrl(
  url: string | undefined | null,
): TargetProductUrlParseResult {
  const original = String(url ?? "").trim();
  if (!original) {
    return {
      ok: false,
      original_url: original,
      code: "INVALID_TARGET_URL",
      message: "Add a Target.com product URL.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(original);
  } catch {
    return {
      ok: false,
      original_url: original,
      code: "INVALID_TARGET_URL",
      message: "Add a valid Target.com product URL.",
    };
  }

  if (parsed.protocol !== "https:" || !isTargetComUrl(original)) {
    return {
      ok: false,
      original_url: original,
      code: "INVALID_TARGET_URL",
      message: "Use a supported https://www.target.com product URL.",
    };
  }

  const normalized = normalizeTargetProductUrl(original);
  if (!normalized) {
    return {
      ok: false,
      original_url: original,
      code: "UNSUPPORTED_TARGET_URL",
      message: "Use a supported Target product URL.",
    };
  }

  const tcin = extractTcinFromTargetUrl(original);
  if (!tcin) {
    return {
      ok: false,
      original_url: original,
      code: "TARGET_IDENTIFIER_MISSING",
      message: "Use a Target product URL that includes an A-TCIN item number.",
    };
  }

  const slug_tokens = extractBoundedSlugTokens(parsed.pathname);
  return {
    ok: true,
    original_url: original,
    normalized_url: normalized,
    tcin,
    slug_tokens,
    product_name: slug_tokens.length > 0 ? slug_tokens.join(" ") : null,
  };
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
