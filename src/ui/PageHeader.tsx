import type { ReactNode } from "react";

export type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: PageHeaderProps) {
  return (
    <header className="n-page-header">
      {eyebrow ? <p className="n-page-header__eyebrow">{eyebrow}</p> : null}
      <h1 className="n-page-header__title">{title}</h1>
      {description ? (
        <p className="n-page-header__desc">{description}</p>
      ) : null}
      {actions ? <div style={{ marginTop: "var(--space-5)" }}>{actions}</div> : null}
    </header>
  );
}
