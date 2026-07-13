import { listPurchases } from "@/web/purchase-service";
import { formatUsd, statusLabel, statusTone } from "@/web/status-copy";
import {
  ButtonLink,
  Card,
  DemoDataBanner,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "@/ui";

export default function DashboardPage() {
  const purchases = listPurchases();

  return (
    <div className="n-screen">
      <PageHeader
        title="Your purchases"
        description="Purchases you’re watching for a lower observed retailer price."
        actions={
          purchases.length > 0 ? (
            <ButtonLink href="/purchases/new" size="sm">
              Track a purchase
            </ButtonLink>
          ) : undefined
        }
      />

      <DemoDataBanner data-testid="fixture-banner">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current retailer price.
        </p>
      </DemoDataBanner>

      {purchases.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing being watched yet"
            description="Add a recent supported purchase and confirm the exact product to begin. Currently: eligible Target.com purchases."
            action={
              <ButtonLink href="/purchases/new" data-testid="empty-dashboard-cta">
                Track a purchase
              </ButtonLink>
            }
          />
          <p className="visually-hidden" data-testid="empty-dashboard">
            No purchases yet.
          </p>
        </Card>
      ) : (
        <ul className="n-purchase-list" data-testid="purchases-table">
          {purchases.map((p) => {
            const status = String(p.status);
            return (
              <li key={String(p.id)}>
                <a
                  className="n-purchase-card"
                  href={`/purchases/${String(p.id)}`}
                  data-testid="purchase-row"
                >
                  <div className="n-purchase-card__top">
                    <StatusBadge
                      label={statusLabel(status)}
                      tone={statusTone(status)}
                    />
                    <span className="muted n-purchase-card__date">
                      {String(p.purchase_date)}
                    </span>
                  </div>
                  <p className="n-purchase-card__title n-break">
                    {String(p.target_product_url)}
                  </p>
                  <p className="n-purchase-card__price">
                    You paid {formatUsd(String(p.purchase_price))}
                  </p>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
