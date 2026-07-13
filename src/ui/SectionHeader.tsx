import type { ReactNode } from "react";

export type SectionHeaderProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  as?: "h2" | "h3";
};

export function SectionHeader({
  title,
  description,
  action,
  as = "h2",
}: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className="n-section-header">
      <div>
        <Heading>{title}</Heading>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
