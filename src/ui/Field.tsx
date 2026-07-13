import type { ReactNode } from "react";

export type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
};

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`n-field${error ? " n-field--error" : ""}`}>
      <label className="n-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true"> *</span>
        ) : null}
      </label>
      {/* Clone described-by via wrapping — child should set aria-describedby when possible */}
      <div data-describedby={describedBy}>{children}</div>
      {hint ? (
        <p id={hintId} className="n-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="n-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
