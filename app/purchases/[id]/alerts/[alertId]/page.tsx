import { getAlert } from "@/web/purchase-service";
import { daysRemaining, formatUsd } from "@/web/status-copy";
import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";
import { notFound } from "next/navigation";
import {
  ButtonLink,
  Card,
  DemoDataBanner,
  Disclosure,
  InlineNotice,
  PageHeader,
  PriceSummary,
} from "@/ui";

export default async function AlertPage({
  params,
}: {
  params: Promise<{ id: string; alertId: string }>;
}) {
  const { id, alertId } = await params;
  const data = getAlert(id, alertId);
  if (!data) notFound();

  const { alert, purchase, claim_route } = data;
  const remaining = daysRemaining(
    purchase?.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
  );
  const disclaimer = String(alert.disclaimer || DEFAULT_POLICY_DISCLAIMER);

  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        eyebrow="Price update"
        title="Price drop found"
        description="A lower observed retailer price appeared while your monitoring window was open."
      />

      <DemoDataBanner data-testid="fixture-banner">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current retailer price.
          <span className="visually-hidden"> DEMO FIXTURE DATA</span>
        </p>
      </DemoDataBanner>

      <Card className="n-result-card" data-testid="alert-summary">
        <p className="n-result-card__kicker">Potential difference</p>
        <p
          className="n-result-card__amount"
          data-testid="potential-recovery"
        >
          Potential recovery {formatUsd(String(alert.potential_recovery))}
        </p>
        <p className="muted" data-testid="result-retailer">
          Retailer: Target
        </p>
        <PriceSummary
          purchasePriceLabel="Purchase price"
          purchasePrice={formatUsd(String(alert.purchase_price))}
          observedPriceLabel="Latest observed price"
          observedPrice={formatUsd(String(alert.observed_price))}
          differenceLabel="Potential difference"
          difference={formatUsd(String(alert.potential_recovery))}
          note={
            remaining != null
              ? `Monitoring window: about ${remaining} day${remaining === 1 ? "" : "s"} remaining.`
              : undefined
          }
        />
        <InlineNotice tone="info">
          <p data-testid="alert-disclaimer">
            Target must verify the current price and makes the final adjustment
            decision. {disclaimer}
          </p>
        </InlineNotice>
      </Card>

      <Card data-testid="target-official-actions">
        <h2 className="n-card-title">Request guidance</h2>
        <p className="muted">
          For this Target purchase, Target must verify the current price and makes the
          final adjustment decision. Nobu does not submit the request.
        </p>
        <ol className="n-list n-list--numbered">
          <li>Keep receipt or purchase information ready.</li>
          <li>
            Open Target’s official help route (online chat or Guest Services{" "}
            {claim_route.guest_services_phone}).
          </li>
          <li>Ask Target to verify the current price.</li>
          <li>Complete any steps Target requires.</li>
        </ol>
        <ButtonLink href="#request-anchor" className="n-btn--block">
          View retailer request steps
        </ButtonLink>
        <p id="request-anchor" className="muted">
          Guest Services: {claim_route.guest_services_phone}. Screenshots are not
          accepted by Target as final proof.
        </p>
      </Card>

      <Disclosure title="How this result was checked">
        <ul className="n-list">
          <li>
            Provider: third-party SerpApi shopping observation (fixture in demo)
          </li>
          <li>Seller evidence: Target (from observation record)</li>
          <li>
            Match evidence: locked product fingerprint for this purchase only
          </li>
          <li>Policy version: target-us-online-price-match-v1</li>
          <li>
            Observed at: stored with the alert; not an official Target API price
          </li>
        </ul>
        <p className="muted">
          No secrets or raw provider payloads are shown. Purchase link:{" "}
          <span className="n-break">
            {String(purchase?.target_product_url ?? "")}
          </span>
        </p>
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
