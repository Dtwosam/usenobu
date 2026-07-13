import type { ReactNode } from "react";
import { IconPackage } from "./icons.js";

export type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className="n-empty">
      <div className="n-empty__icon" aria-hidden>
        {icon ?? <IconPackage />}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
