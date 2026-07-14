/**
 * Google Immersive Product response helpers.
 * Used to recover merchant Target.com links when Shopping results only
 * expose Google product_link (new Shopping layout).
 * SerpApi is third-party observation — not an official Target API.
 */
import { classifySeller } from "./normalize.js";
import { extractTcinFromTargetUrl, isTargetComUrl } from "../matching/identity.js";

export interface ImmersiveStoreOffer {
  name: string;
  title: string;
  link: string;
  extracted_price?: number;
  seller_kind: string;
  is_target_plus: boolean;
  target_item_id: string | null;
}

export interface ImmersiveProductParseResult {
  title?: string;
  stores: ImmersiveStoreOffer[];
  target_stores: ImmersiveStoreOffer[];
}

function parsePrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (!cleaned) return undefined;
    const n = Number(cleaned);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Parse SerpApi google_immersive_product JSON into store offers.
 * Does not invent TCINs — only extracts from Target.com URLs.
 */
export function parseImmersiveProductResponse(
  raw: unknown,
): ImmersiveProductParseResult {
  if (!raw || typeof raw !== "object") {
    return { stores: [], target_stores: [] };
  }
  const root = raw as Record<string, unknown>;
  const product =
    root.product_results && typeof root.product_results === "object"
      ? (root.product_results as Record<string, unknown>)
      : root;

  const title = typeof product.title === "string" ? product.title : undefined;
  const storesRaw = Array.isArray(product.stores) ? product.stores : [];
  const stores: ImmersiveStoreOffer[] = [];

  for (const row of storesRaw) {
    if (!row || typeof row !== "object") continue;
    const s = row as Record<string, unknown>;
    const name = typeof s.name === "string" ? s.name : "";
    const link = typeof s.link === "string" ? s.link : "";
    const storeTitle =
      typeof s.title === "string" ? s.title : title ?? "";
    if (!name || !link) continue;

    const { seller_kind, is_target_plus } = classifySeller(name);
    const target_item_id = isTargetComUrl(link)
      ? extractTcinFromTargetUrl(link)
      : null;

    stores.push({
      name,
      title: storeTitle,
      link,
      extracted_price:
        parsePrice(s.extracted_price) ?? parsePrice(s.price),
      seller_kind,
      is_target_plus,
      target_item_id,
    });
  }

  const target_stores = stores.filter(
    (s) => s.seller_kind === "target" && !s.is_target_plus && isTargetComUrl(s.link),
  );

  return { title, stores, target_stores };
}
