import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  /** Label shown while loading (defaults to “Working…”). */
  loadingLabel?: string;
  block?: boolean;
  size?: "md" | "sm";
  children: ReactNode;
  /** Explains why the control is unavailable when disabled. */
  disabledReason?: string;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "",
  secondary: "n-btn--secondary",
  ghost: "n-btn--ghost",
  danger: "n-btn--danger",
};

export function Button({
  variant = "primary",
  loading = false,
  loadingLabel = "Working…",
  block = false,
  size = "md",
  disabled,
  disabledReason,
  children,
  className = "",
  type = "button",
  title,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const classes = [
    "n-btn",
    variantClass[variant],
    size === "sm" ? "n-btn--sm" : "",
    block ? "n-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-disabled={isDisabled || undefined}
      title={isDisabled && disabledReason ? disabledReason : title}
      {...rest}
    >
      {loading ? <span className="n-btn__spinner" aria-hidden /> : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}

export type ButtonLinkProps = {
  href: string;
  variant?: ButtonVariant;
  block?: boolean;
  size?: "md" | "sm";
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
  target?: string;
  rel?: string;
};

export function ButtonLink({
  href,
  variant = "primary",
  block = false,
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = [
    "n-btn",
    variantClass[variant],
    size === "sm" ? "n-btn--sm" : "",
    block ? "n-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <a href={href} className={classes} {...rest}>
      {children}
    </a>
  );
}
