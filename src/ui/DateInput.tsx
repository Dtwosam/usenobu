import type { InputHTMLAttributes } from "react";
import { Input } from "./Input.js";

export type DateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  invalid?: boolean;
};

export function DateInput({ invalid = false, ...rest }: DateInputProps) {
  return <Input type="date" invalid={invalid} {...rest} />;
}
