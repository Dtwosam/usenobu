import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: "",
  brand: "n-badge--brand",
  success: "n-badge--success",
  warning: "n-badge--warning",
  danger: "n-badge--danger",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: BadgeProps) {
  return (
    <span className={`n-badge ${toneClass[tone]} ${className}`.trim()}>
      {children}
    </span>
  );
}
