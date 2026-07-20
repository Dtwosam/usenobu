"use client";

import { getOkxMarketplaceCta } from "@/web/okx-marketplace";
import { ButtonLink } from "./Button.js";

type Props = {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  block?: boolean;
  className?: string;
  "data-testid"?: string;
  /** When true, render a text anchor instead of a button-styled link. */
  textLink?: boolean;
};

/**
 * Single source for OKX marketplace CTAs.
 * Uses NEXT_PUBLIC_OKX_MARKETPLACE_URL when set; otherwise /okx.
 */
export function OkxMarketplaceLink({
  variant = "secondary",
  size = "md",
  block,
  className,
  "data-testid": testId = "cta-okx-marketplace",
  textLink = false,
}: Props) {
  const cta = getOkxMarketplaceCta();
  const externalProps = cta.external
    ? {
        target: "_blank" as const,
        rel: "noopener noreferrer",
      }
    : {};

  if (textLink) {
    return (
      <a
        href={cta.href}
        className={className}
        data-testid={testId}
        {...externalProps}
      >
        {cta.label}
        {cta.external ? (
          <span className="visually-hidden"> (opens in a new tab)</span>
        ) : null}
      </a>
    );
  }

  return (
    <ButtonLink
      href={cta.href}
      variant={variant}
      size={size}
      block={block}
      className={className}
      data-testid={testId}
      {...externalProps}
    >
      {cta.label}
      {cta.external ? (
        <span className="visually-hidden"> (opens in a new tab)</span>
      ) : null}
    </ButtonLink>
  );
}
