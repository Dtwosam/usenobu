"use client";

import { useState } from "react";
import { Button, Disclosure } from "@/ui";

export type ActionCenterProps = {
  /** Official Target request/support route (never a blog). */
  contactUrl: string;
  copyText: string;
  heading: string;
  purchasePrice: string;
  observedPrice: string;
  potentialDifference: string;
  daysRemainingLabel?: string | null;
  evidence: {
    provider_label: string;
    seller: string;
    match_evidence: string;
    observed_at: string;
    policy_deadline: string;
    checklist: string[];
  };
};

/**
 * Price-drop Action Center.
 * Primary: open Target's official request route (user submits — Nobu never does).
 * Secondary: copy request details, view evidence.
 */
export function ActionCenter({
  contactUrl,
  copyText,
  heading,
  purchasePrice,
  observedPrice,
  potentialDifference,
  daysRemainingLabel,
  evidence,
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
      <h2 className="n-card-title" data-testid="action-center-heading">
        {heading}
      </h2>

      <dl className="n-kv n-action-center__summary" data-testid="price-summary">
        <div>
          <dt>Purchase price</dt>
          <dd data-testid="action-purchase-price">{purchasePrice}</dd>
        </div>
        <div>
          <dt>Observed Target price</dt>
          <dd data-testid="action-observed-price">{observedPrice}</dd>
        </div>
        <div>
          <dt>Potential difference</dt>
          <dd data-testid="action-difference">{potentialDifference}</dd>
        </div>
        {daysRemainingLabel ? (
          <div>
            <dt>Days remaining</dt>
            <dd data-testid="action-days-remaining">{daysRemainingLabel}</dd>
          </div>
        ) : null}
      </dl>

      <div className="n-action-center__actions">
        <a
          href={contactUrl}
          className="n-btn n-btn--block"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="request-from-target"
        >
          Request the difference from Target
        </a>

        <Button
          type="button"
          variant="secondary"
          block
          onClick={onCopy}
          data-testid="copy-details"
        >
          Copy request details
        </Button>
      </div>

      {copied ? (
        <p
          className="muted n-action-center__copied"
          data-testid="copy-success"
          role="status"
        >
          Request details copied.
        </p>
      ) : null}

      <div className="n-action-center__evidence" data-testid="view-evidence">
        <Disclosure title="View evidence">
          <dl className="n-kv" data-testid="action-details">
            <div>
              <dt>Price source</dt>
              <dd data-testid="detail-provider">{evidence.provider_label}</dd>
            </div>
            <div>
              <dt>Seller</dt>
              <dd data-testid="detail-seller">{evidence.seller}</dd>
            </div>
            <div>
              <dt>Match evidence</dt>
              <dd data-testid="detail-match">{evidence.match_evidence}</dd>
            </div>
            <div>
              <dt>Observation time</dt>
              <dd data-testid="detail-observed-at">{evidence.observed_at}</dd>
            </div>
            <div>
              <dt>Policy deadline</dt>
              <dd data-testid="detail-policy-deadline">
                {evidence.policy_deadline}
              </dd>
            </div>
          </dl>
          <div data-testid="request-checklist">
            <p>
              <strong>Request checklist</strong>
            </p>
            <ul className="n-list">
              {evidence.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
