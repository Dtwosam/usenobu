import { getAlert } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { daysRemaining, formatUsd } from "@/web/status-copy";
import {
  ACTION_TRUST_NOTE,
  FIXTURE_UI_LABEL,
} from "@/web/action-center";
import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";
import { getOrCreateSessionOwner } from "@/web/session-owner";
import { notFound } from "next/navigation";
import {
  ButtonLink,
  Card,
  DemoDataBanner,
  PageHeader,
} from "@/ui";
import { ActionCenter } from "./ActionCenter";

export default async function AlertPage({
  params,
}: {
  params: Promise<{ id: string; alertId: string }>;
}) {
  const { id, alertId } = await params;
  await prepareWebDatabase();
  const ownerRef = await getOrCreateSessionOwner();
  const data = getAlert(id, alertId, { owner_ref: ownerRef });
  if (!data) notFound();

  const { alert, purchase, observation, fingerprint, action, claim_route } =
    data;
  const remaining = daysRemaining(
    purchase?.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
  );
  const disclaimer = String(alert.disclaimer || DEFAULT_POLICY_DISCLAIMER);
  const daysLabel =
    remaining != null
      ? `${remaining} day${remaining === 1 ? "" : "s"} remaining`
      : null;

  if (!action.show) {
    // Defensive: alert row without a valid lower-price recovery should not drive actions
    return (
      <div className="n-screen n-screen--reading">
        <PageHeader
          eyebrow="Price update"
          title="No action needed"
          description="This result is not a confirmed lower price."
        />
        <ButtonLink
          href={`/purchases/${id}`}
          variant="secondary"
          data-testid="back-dashboard"
        >
          Back to this purchase
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        eyebrow="Price update"
        title="Possible price difference"
        description="A lower observed Target price appeared while monitoring was open. Nobu guides you through Target’s official request process but never submits the request."
      />

      {action.is_fixture ? (
        <DemoDataBanner data-testid="fixture-banner">
          <p data-testid="fixture-label">
            <strong>Demo data</strong>
            <br />
            {FIXTURE_UI_LABEL}
            <span className="visually-hidden"> DEMO FIXTURE DATA</span>
          </p>
        </DemoDataBanner>
      ) : null}

      <Card className="n-result-card" data-testid="alert-summary">
        <p className="visually-hidden" data-testid="potential-recovery">
          Potential recovery {formatUsd(String(alert.potential_recovery))}
        </p>
        <p className="visually-hidden" data-testid="alert-disclaimer">
          {disclaimer}
        </p>

        <p className="muted n-trust-note" data-testid="trust-note">
          {ACTION_TRUST_NOTE}
        </p>

        <ActionCenter
          contactUrl={action.contact_url}
          copyText={action.copy_text}
          heading={action.heading}
          purchasePrice={action.purchase_price_label}
          observedPrice={action.observed_price_label}
          potentialDifference={action.difference_label}
          daysRemainingLabel={daysLabel}
          evidence={action.evidence}
        />

        {/* Legacy test hooks */}
        <p className="visually-hidden" data-testid="target-official-actions">
          Guest Services {claim_route.guest_services_phone}
        </p>
        {action.trusted_target_url ? (
          <p className="visually-hidden" data-testid="open-on-target">
            {action.trusted_target_url}
          </p>
        ) : null}
        <p className="visually-hidden" data-testid="contact-target">
          {action.contact_url}
        </p>
      </Card>

      <ButtonLink
        href={`/purchases/${id}`}
        variant="secondary"
        data-testid="back-dashboard"
      >
        Back to this purchase
      </ButtonLink>
    </div>
  );
}
