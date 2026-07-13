import type { ReactNode } from "react";
import { IconInfo } from "./icons.js";

export type DemoDataBannerProps = {
  children?: ReactNode;
  "data-testid"?: string;
};

export function DemoDataBanner({
  children,
  ...rest
}: DemoDataBannerProps) {
  return (
    <div className="n-demo-banner" role="status" {...rest}>
      <IconInfo />
      <div>
        {children ?? (
          <p>
            <strong>Demo data</strong>
            <br />
            This screen uses test fixtures, not a live current Target price.
          </p>
        )}
      </div>
    </div>
  );
}
