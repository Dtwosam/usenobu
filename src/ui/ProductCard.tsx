import type { ReactNode } from "react";
import { Card } from "./Card.js";

export type ProductCardProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: ReactNode;
  footer?: ReactNode;
  "data-testid"?: string;
};

export function ProductCard({
  title,
  subtitle,
  meta,
  badge,
  footer,
  ...rest
}: ProductCardProps) {
  return (
    <Card className="n-product-card" {...rest}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          alignItems: "flex-start",
        }}
      >
        <div>
          <h3 className="n-product-card__title">{title}</h3>
          {subtitle ? (
            <p className="n-product-card__meta">{subtitle}</p>
          ) : null}
          {meta ? <p className="n-product-card__meta">{meta}</p> : null}
        </div>
        {badge}
      </div>
      {footer}
    </Card>
  );
}
