import type { HTMLAttributes, ReactNode } from "react";

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  subtle?: boolean;
  paddedLg?: boolean;
};

export function Card({
  children,
  subtle = false,
  paddedLg = false,
  className = "",
  ...rest
}: CardProps) {
  const classes = [
    "n-card",
    subtle ? "n-card--subtle" : "",
    paddedLg ? "n-card--padded-lg" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
