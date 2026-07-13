import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  variant?: "ghost" | "solid";
  disabledReason?: string;
};

export function IconButton({
  label,
  children,
  variant = "ghost",
  disabled,
  disabledReason,
  className = "",
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={`n-icon-btn ${className}`.trim()}
      data-variant={variant}
      aria-label={label}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title ?? label}
      {...rest}
    >
      {children}
    </button>
  );
}
