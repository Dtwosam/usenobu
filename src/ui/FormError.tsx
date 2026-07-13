import type { ReactNode } from "react";
import { IconAlert } from "./icons.js";

export type FormErrorProps = {
  title?: string;
  children: ReactNode;
  "data-testid"?: string;
};

export function FormError({
  title = "Something needs your attention",
  children,
  ...rest
}: FormErrorProps) {
  return (
    <div className="n-form-error" role="alert" {...rest}>
      <IconAlert />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}
