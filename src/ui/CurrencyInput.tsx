import type { InputHTMLAttributes } from "react";

export type CurrencyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  invalid?: boolean;
  currencySymbol?: string;
};

export function CurrencyInput({
  invalid = false,
  currencySymbol = "$",
  className = "",
  id,
  ...rest
}: CurrencyInputProps) {
  return (
    <div className="n-currency">
      <span className="n-currency__prefix" aria-hidden>
        {currencySymbol}
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className={`n-input ${className}`.trim()}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    </div>
  );
}
