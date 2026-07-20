import { describe, expect, it } from "vitest";
import {
  getOkxMarketplaceCta,
  getOkxMarketplaceHref,
  OKX_GUIDE_PATH,
  OKX_MARKETPLACE_CTA_LABEL,
} from "../../src/web/okx-marketplace.js";

describe("OKX marketplace configuration", () => {
  it("falls back to local guide when env is absent", () => {
    expect(getOkxMarketplaceHref({})).toEqual({
      href: OKX_GUIDE_PATH,
      external: false,
    });
  });

  it("falls back when URL is not https", () => {
    expect(
      getOkxMarketplaceHref({
        NEXT_PUBLIC_OKX_MARKETPLACE_URL: "http://example.com/listing",
      }),
    ).toEqual({ href: OKX_GUIDE_PATH, external: false });
  });

  it("falls back on invalid URL", () => {
    expect(
      getOkxMarketplaceHref({
        NEXT_PUBLIC_OKX_MARKETPLACE_URL: "not a url",
      }),
    ).toEqual({ href: OKX_GUIDE_PATH, external: false });
  });

  it("uses valid https marketplace URL", () => {
    const result = getOkxMarketplaceHref({
      NEXT_PUBLIC_OKX_MARKETPLACE_URL: "https://example.com/okx/nobu",
    });
    expect(result.external).toBe(true);
    expect(result.href).toBe("https://example.com/okx/nobu");
  });

  it("exports stable CTA label", () => {
    expect(OKX_MARKETPLACE_CTA_LABEL).toBe("Use Nobu with OKX.AI");
    const cta = getOkxMarketplaceCta();
    expect(cta.label).toBe("Use Nobu with OKX.AI");
    expect(cta.href).toBeTruthy();
  });
});
