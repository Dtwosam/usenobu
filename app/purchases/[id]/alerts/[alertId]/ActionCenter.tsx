"use client";

import { useState } from "react";
import { Button } from "@/ui";

export type ActionCenterProps = {
  trustedTargetUrl: string | null;
  contactUrl: string;
  copyText: string;
};

/**
 * Compact actions for a valid price-difference result.
 * Primary: Open on Target · Secondary: Contact Target, Copy details
 */
export function ActionCenter({
  trustedTargetUrl,
  contactUrl,
  copyText,
}: ActionCenterProps) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = copyText;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2500);
      } catch {
        setCopied(false);
      }
    }
  }

  return (
    <div className="n-action-center" data-testid="action-center">
      <div className="n-action-center__actions">
        {trustedTargetUrl ? (
          <a
            href={trustedTargetUrl}
            className="n-btn n-btn--block"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-on-target"
          >
            Open on Target
          </a>
        ) : null}

        <a
          href={contactUrl}
          className="n-btn n-btn--secondary n-btn--block"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="contact-target"
        >
          Contact Target
        </a>

        <Button
          type="button"
          variant="secondary"
          block
          onClick={onCopy}
          data-testid="copy-details"
        >
          Copy details
        </Button>
      </div>

      {copied ? (
        <p
          className="muted n-action-center__copied"
          data-testid="copy-success"
          role="status"
        >
          Details copied.
        </p>
      ) : null}
    </div>
  );
}
