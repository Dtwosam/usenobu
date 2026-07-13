/**
 * User-facing status labels only — never surface raw API enums as primary copy.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type StatusBadgeProps = {
  /** Plain-English status for the user */
  label: string;
  tone?: StatusTone;
  className?: string;
  "data-testid"?: string;
};

const toneClass: Record<StatusTone, string> = {
  neutral: "n-status--neutral",
  info: "n-status--info",
  success: "n-status--success",
  warning: "n-status--warning",
  danger: "n-status--danger",
};

export function StatusBadge({
  label,
  tone = "neutral",
  className = "",
  ...rest
}: StatusBadgeProps) {
  return (
    <span className={`n-status ${toneClass[tone]} ${className}`.trim()} {...rest}>
      <span className="n-status__dot" aria-hidden />
      {label}
    </span>
  );
}
