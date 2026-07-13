import { getAlert } from "@/web/purchase-service";
import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";
import { notFound } from "next/navigation";

export default async function AlertPage({
  params,
}: {
  params: Promise<{ id: string; alertId: string }>;
}) {
  const { id, alertId } = await params;
  const data = getAlert(id, alertId);
  if (!data) notFound();

  const { alert, purchase, claim_route, fixture_banner } = data;

  return (
    <div>
      <h1>Price drop result</h1>
      <div className="banner-fixture" data-testid="fixture-banner">
        {fixture_banner}
      </div>

      <div className="banner-ok" data-testid="alert-summary">
        <strong>Price drop detected</strong> (potential eligibility only). Observed
        Target price is third-party data. Target must verify and decides any
        adjustment. AfterBuy does <strong>not</strong> guarantee a refund.
      </div>

      <div className="card" data-testid="alert-details">
        <p>
          <strong>Purchase price:</strong> ${String(alert.purchase_price)}{" "}
          {String(alert.currency)}
        </p>
        <p>
          <strong>Observed Target price:</strong> ${String(alert.observed_price)}{" "}
          {String(alert.currency)}
        </p>
        <p data-testid="potential-recovery">
          <strong>Potential recovery:</strong> ${String(alert.potential_recovery)}{" "}
          {String(alert.currency)}
        </p>
        <p>
          <strong>Status:</strong> {String(alert.status)}
        </p>
        <p className="muted" data-testid="alert-disclaimer">
          {String(alert.disclaimer || DEFAULT_POLICY_DISCLAIMER)}
        </p>
      </div>

      <div className="card" data-testid="target-official-actions">
        <h2>Official Target next steps</h2>
        <ol className="notices">
          <li>Keep your original receipt, digital receipt, or packing slip.</li>
          <li>
            Contact Target online chat or Guest Services (
            {claim_route.guest_services_phone}).
          </li>
          <li>
            Target team members verify the current lower price. Screenshots are not
            accepted as final proof by Target.
          </li>
          <li>
            Target makes the final decision. AfterBuy does not submit claims or log
            into your Target account.
          </li>
        </ol>
        <p className="muted">
          Purchase: {String(purchase?.target_product_url ?? "")}
        </p>
      </div>

      <a className="btn secondary" href={`/purchases/${id}`} data-testid="back-dashboard">
        Back to dashboard
      </a>
    </div>
  );
}
