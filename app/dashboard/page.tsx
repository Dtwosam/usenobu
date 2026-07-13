import { listPurchases } from "@/web/purchase-service";
import { FIXTURE_BANNER } from "@/web/fixtures";

export default function DashboardPage() {
  const purchases = listPurchases();

  return (
    <div>
      <h1>Purchases</h1>
      <div className="banner-fixture" data-testid="fixture-banner">
        {FIXTURE_BANNER}
      </div>
      <div className="card">
        {purchases.length === 0 ? (
          <p data-testid="empty-dashboard">
            No purchases yet.{" "}
            <a href="/purchases/new">Add a Target purchase</a>.
          </p>
        ) : (
          <table data-testid="purchases-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Price</th>
                <th>Date</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={String(p.id)}>
                  <td>
                    <a href={`/purchases/${String(p.id)}`}>{String(p.status)}</a>
                  </td>
                  <td>
                    ${String(p.purchase_price)} {String(p.currency)}
                  </td>
                  <td>{String(p.purchase_date)}</td>
                  <td className="muted">{String(p.target_product_url)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
