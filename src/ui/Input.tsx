import type { InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export function Input({
  invalid = false,
  className = "",
  id,
  ...rest
}: InputProps) {
  return (
    <input
      id={id}
      className={`n-input ${className}`.trim()}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
