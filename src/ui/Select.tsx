import type { SelectHTMLAttributes, ReactNode } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
  children: ReactNode;
};

export function Select({
  invalid = false,
  className = "",
  children,
  id,
  ...rest
}: SelectProps) {
  return (
    <select
      id={id}
      className={`n-select ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    >
      {children}
    </select>
  );
}
