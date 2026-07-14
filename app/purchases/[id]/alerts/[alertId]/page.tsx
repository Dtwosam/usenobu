import { getAlert } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { daysRemaining, formatUsd } from "@/web/status-copy";
import {
  ACTION_TRUST_NOTE,
  FIXTURE_UI_LABEL,
} from "@/web/action-center";
import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";
import { notFound } from "next/navigation";
import {
  ButtonLink,
  Card,
  DemoDataBanner,
  Disclosure,
  PageHeader,
  PriceSummary,
} from "@/ui";
import { ActionCenter } from "./ActionCenter";

export default async function AlertPage({
  params,
}: {
  params: Promise<{ id: string; alertId: string }>;
}) {
  const { id, alertId } = await params;
  await prepareWebDatabase();
  const data = getAlert(id, alertId);
  if (!data) notFound();

  const { alert, purchase, observation, fingerprint, action, claim_route } =
    data;
  const remaining = daysRemaining(
    purchase?.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
  );
  const disclaimer = String(alert.disclaimer || DEFAULT_POLICY_DISCLAIMER);

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
        description="A lower observed Target price appeared while monitoring was open."
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
        <p className="visually-hidden" data-testid="action-center-heading">
          Possible price difference
        </p>
        <p className="visually-hidden" data-testid="potential-recovery">
          Potential recovery {formatUsd(String(alert.potential_recovery))}
        </p>

        <PriceSummary
          purchasePriceLabel="Purchase price"
          purchasePrice={formatUsd(String(alert.purchase_price))}
          observedPriceLabel="Observed price"
          observedPrice={formatUsd(String(alert.observed_price))}
          differenceLabel="Potential difference"
          difference={formatUsd(String(alert.potential_recovery))}
          note={
            remaining != null
              ? `${remaining} day${remaining === 1 ? "" : "s"} remaining`
              : undefined
          }
        />

        <p className="muted n-trust-note" data-testid="trust-note">
          {ACTION_TRUST_NOTE}
        </p>
        <p className="visually-hidden" data-testid="alert-disclaimer">
          {disclaimer}
        </p>

        <ActionCenter
          trustedTargetUrl={action.trusted_target_url}
          contactUrl={action.contact_url}
          copyText={action.copy_text}
        />

        {/* Legacy test hook for Guest Services phone */}
        <p className="visually-hidden" data-testid="target-official-actions">
          Guest Services {claim_route.guest_services_phone}
        </p>
      </Card>

      <Disclosure title="View details">
        <dl className="n-kv" data-testid="action-details">
          <div>
            <dt>Exact product</dt>
            <dd data-testid="detail-product">{action.product_title}</dd>
          </div>
          <div>
            <dt>Matched identifiers</dt>
            <dd data-testid="detail-ids">
              {[
                fingerprint?.target_item_id
                  ? `TCIN ${String(fingerprint.target_item_id)}`
                  : null,
                fingerprint?.model_number
                  ? `Model ${String(fingerprint.model_number)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Locked fingerprint on file"}
            </dd>
          </div>
          <div>
            <dt>Seller confirmation</dt>
            <dd data-testid="detail-seller">
              {observation?.seller_text
                ? String(observation.seller_text)
                : "Target"}
            </dd>
          </div>
          <div>
            <dt>Observation time</dt>
            <dd data-testid="detail-observed-at">
              {observation?.observed_at
                ? String(observation.observed_at)
                : String(alert.created_at)}
            </dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd data-testid="detail-provider">
              {action.data_source === "LIVE"
                ? "SerpApi (third-party observation)"
                : "Test fixture (not live)"}
            </dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd data-testid="detail-engine">
              {observation?.engine
                ? String(observation.engine)
                : "google_shopping"}
            </dd>
          </div>
          <div>
            <dt>Matching decision</dt>
            <dd data-testid="detail-match">
              Exact locked-fingerprint match accepted
            </dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd data-testid="detail-policy">
              target-us-online-price-match-v1 · Target verifies and decides
            </dd>
          </div>
          <div>
            <dt>Alert reason</dt>
            <dd data-testid="detail-alert-reason">
              Observed price lower than purchase price within monitoring window
            </dd>
          </div>
          <div>
            <dt>Provenance</dt>
            <dd data-testid="detail-provenance">
              Third-party search observation
              {action.trusted_target_url
                ? ` · ${action.trusted_target_url}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Data source</dt>
            <dd data-testid="detail-data-source">{action.data_source}</dd>
          </div>
        </dl>
      </Disclosure>

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
