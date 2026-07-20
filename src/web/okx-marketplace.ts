/**
 * Centralized public OKX.AI marketplace configuration (Lane 8R.1).
 * Every OKX CTA must use this module — never hardcode listing URLs.
 */
export const OKX_GUIDE_PATH = "/okx";
export const OKX_MARKETPLACE_CTA_LABEL = "Use Nobu with OKX.AI";

/**
 * Resolved marketplace destination.
 * When NEXT_PUBLIC_OKX_MARKETPLACE_URL is a valid https URL, use it;
 * otherwise fall back to the local guide page.
 */
export function getOkxMarketplaceHref(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { href: string; external: boolean } {
  const raw = String(env.NEXT_PUBLIC_OKX_MARKETPLACE_URL || "").trim();
  if (!raw) return { href: OKX_GUIDE_PATH, external: false };
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") {
      return { href: OKX_GUIDE_PATH, external: false };
    }
    return { href: u.toString(), external: true };
  } catch {
    return { href: OKX_GUIDE_PATH, external: false };
  }
}

/** Client-safe props for marketplace CTAs (reads public env at runtime). */
export function getOkxMarketplaceCta(): {
  href: string;
  external: boolean;
  label: string;
} {
  const resolved = getOkxMarketplaceHref(
    typeof process !== "undefined" ? process.env : {},
  );
  return {
    ...resolved,
    label: OKX_MARKETPLACE_CTA_LABEL,
  };
}
