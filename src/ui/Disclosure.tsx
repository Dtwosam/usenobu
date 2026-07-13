import type { ReactNode } from "react";
import { IconChevron } from "./icons.js";

export type DisclosureProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: DisclosureProps) {
  return (
    <details className="n-disclosure" open={defaultOpen || undefined}>
      <summary className="n-disclosure__summary">
        <span>{title}</span>
        <IconChevron />
      </summary>
      <div className="n-disclosure__body">{children}</div>
    </details>
  );
}
