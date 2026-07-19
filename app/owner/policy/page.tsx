import { Card, InlineNotice, PageHeader } from "@/ui";
import { getWebDatabase } from "@/web/db";
import { policyStatusSnapshot } from "@/policy/operations/store";
import { getOwnerOpsSecret } from "@/policy/operations/auth";

/**
 * Minimal protected policy-status page.
 * Server-rendered snapshot for operators. Mutations require API bearer auth.
 * Does not expose secrets.
 */
export default function OwnerPolicyPage() {
  const secretConfigured = Boolean(getOwnerOpsSecret());
  let snap: ReturnType<typeof policyStatusSnapshot> | null = null;
  let loadError: string | null = null;

  try {
    const db = getWebDatabase();
    snap = policyStatusSnapshot(db, new Date().toISOString());
  } catch (err) {
    loadError = err instanceof Error ? err.message : "load_failed";
  }

  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        title="Policy operations"
        description="Owner review status for the approved Target U.S. online price-match policy. Manual review of the official Target policy URL only — no scraping."
      />

      <div className="n-stack">
        {!secretConfigured && (
          <InlineNotice tone="warning" data-testid="owner-secret-missing">
            Owner/cron secret is not configured on this runtime. Review mutations
            via API will return 503 until OWNER_OPS_SECRET or CRON_SECRET is set.
          </InlineNotice>
        )}

        {loadError && (
          <InlineNotice tone="danger" data-testid="owner-policy-load-error">
            Could not load policy operations: {loadError}
          </InlineNotice>
        )}

        {snap && (
          <>
            {snap.runtime.warning && (
              <InlineNotice tone="warning" data-testid="policy-review-warning">
                {snap.runtime.warning}
              </InlineNotice>
            )}

            <Card data-testid="owner-policy-status">
              <h2 className="n-card-title">Current policy operations</h2>
              <ul className="n-list">
                <li>
                  <strong>Policy ID:</strong> {snap.runtime.record.policy_id}
                </li>
                <li>
                  <strong>Version:</strong> {snap.runtime.record.policy_version}
                </li>
                <li>
                  <strong>Review state:</strong>{" "}
                  <span data-testid="policy-review-state">
                    {snap.runtime.effective_state}
                  </span>
                </li>
                <li>
                  <strong>Source last checked:</strong>{" "}
                  {snap.runtime.record.source_last_checked_at}
                </li>
                <li>
                  <strong>Next review at:</strong>{" "}
                  {snap.runtime.record.next_review_at}
                </li>
                <li>
                  <strong>Pending owner actions:</strong>{" "}
                  <span data-testid="pending-action-count">
                    {snap.active_owner_alerts}
                  </span>
                </li>
                <li>
                  <strong>Pending material-change reviews:</strong>{" "}
                  {snap.pending_reviews}
                </li>
              </ul>
              <p className="muted">
                Official source (manual review only):{" "}
                <a
                  href={snap.runtime.record.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Target Price Match Guarantee
                </a>
              </p>
            </Card>

            <Card>
              <h2 className="n-card-title">Owner API</h2>
              <p>
                Record reviews with{" "}
                <code>POST /v1/owner/policy-review</code> (Bearer secret).
                Actions: <code>UNCHANGED</code>,{" "}
                <code>MATERIAL_CHANGE_DETECTED</code>,{" "}
                <code>SOURCE_UNAVAILABLE</code>, <code>RETIRED</code>.
              </p>
              <p className="muted">
                <code>UNCHANGED</code> restores CURRENT without a code change or
                redeploy. Material changes never auto-apply new eligibility rules.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
