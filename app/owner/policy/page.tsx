import { Card, InlineNotice, PageHeader } from "@/ui";
import { getOwnerOpsSecret, getCronSecret } from "@/policy/operations/auth";

/**
 * Operator documentation page only — no unauthenticated policy-state dump.
 * Live status and mutations require protected /v1/owner/* APIs with bearer secrets.
 */
export default function OwnerPolicyPage() {
  const ownerConfigured = Boolean(getOwnerOpsSecret());
  const cronConfigured = Boolean(getCronSecret());

  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        title="Policy operations"
        description="Protected Target U.S. price-match policy review. Manual official-source review only — no scraping. Live state is not exposed on this public page."
      />

      <div className="n-stack">
        <InlineNotice tone="info" data-testid="owner-policy-protected-notice">
          Policy operations status is available only via authorized API routes. This
          page does not load or display durable policy state without authentication.
        </InlineNotice>

        {(!ownerConfigured || !cronConfigured) && (
          <InlineNotice tone="warning" data-testid="owner-secret-missing">
            {!ownerConfigured && (
              <span>
                OWNER_OPS_SECRET is not configured for owner review/status.{" "}
              </span>
            )}
            {!cronConfigured && (
              <span>CRON_SECRET is not configured for the policy scheduler. </span>
            )}
            Configure secrets through the secure deployment environment workflow —
            never in browser-exposed variables.
          </InlineNotice>
        )}

        <Card data-testid="owner-policy-api-docs">
          <h2 className="n-card-title">Protected APIs</h2>
          <ul className="n-list">
            <li>
              <code>GET /v1/owner/policy-status</code> — Bearer OWNER_OPS_SECRET or
              CRON_SECRET
            </li>
            <li>
              <code>POST /v1/owner/policy-review</code> — Bearer OWNER_OPS_SECRET;
              actions: UNCHANGED, MATERIAL_CHANGE_DETECTED, SOURCE_UNAVAILABLE,
              RETIRED
            </li>
            <li>
              <code>POST /v1/owner/policy-scheduler</code> — Bearer CRON_SECRET;
              idempotent CHECK_DUE transition
            </li>
          </ul>
          <p className="muted">
            UNCHANGED restores CURRENT without a code change or redeploy. Material
            changes never auto-apply new eligibility rules. Target makes the final
            decision.
          </p>
        </Card>
      </div>
    </div>
  );
}
