export type LoadingSkeletonProps = {
  variant?: "text" | "title" | "block";
  width?: string;
  className?: string;
  "aria-label"?: string;
};

export function LoadingSkeleton({
  variant = "text",
  width,
  className = "",
  "aria-label": ariaLabel = "Loading",
}: LoadingSkeletonProps) {
  const variantClass =
    variant === "title"
      ? "n-skeleton--title"
      : variant === "block"
        ? "n-skeleton--block"
        : "n-skeleton--text";

  return (
    <span
      className={`n-skeleton ${variantClass} ${className}`.trim()}
      style={width ? { width } : undefined}
      role="status"
      aria-label={ariaLabel}
    />
  );
}
