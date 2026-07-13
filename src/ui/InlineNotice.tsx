import type { ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo } from "./icons.js";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

export type InlineNoticeProps = {
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
};

const toneClass: Record<NoticeTone, string> = {
  neutral: "",
  info: "n-notice--info",
  success: "n-notice--success",
  warning: "n-notice--warning",
  danger: "n-notice--danger",
};

function iconFor(tone: NoticeTone) {
  if (tone === "success") return <IconCheck />;
  if (tone === "warning" || tone === "danger") return <IconAlert />;
  return <IconInfo />;
}

export function InlineNotice({
  tone = "info",
  children,
  className = "",
  ...rest
}: InlineNoticeProps) {
  return (
    <div
      className={`n-notice ${toneClass[tone]} ${className}`.trim()}
      role="status"
      {...rest}
    >
      {iconFor(tone)}
      <div>{children}</div>
    </div>
  );
}
