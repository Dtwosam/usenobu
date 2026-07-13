import { runCheckAction } from "@/web/actions";
import { getPurchaseDetail } from "@/web/purchase-service";
import { notFound } from "next/navigation";

export default async function PurchaseDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const detail = getPurchaseDetail(id);
  if (!detail) notFound();

  const { purchase, fingerprint, observations, alerts, runs, fixture_banner } =
    detail;
  const monitoring = purchase.status === "MONITORING_ACTIVE" && purchase.fingerprint_id;

  return (
    <div>
      <h1>Monitoring dashboard</h1>
      <div className="banner-fixture" data-testid="fixture-banner">
        {fixture_banner}
      </div>

      {sp.checked ? (
        <div className="banner-ok" data-testid="check-complete">
          Price check completed (fixture observation). See history and alerts below.
        </div>
      ) : null}
      {sp.error ? (
        <div className="banner-warn" data-testid="dashboard-error">
          {sp.error}
        </div>
      ) : null}

      <div className="card" data-testid="purchase-status">
        <h2>Purchase</h2>
        <p>
          <span className="pill" data-testid="status-pill">
            {String(purchase.status)}
          </span>
        </p>
        <p>
          <strong>URL:</strong> {String(purchase.target_product_url)}
        </p>
        <p>
          <strong>Purchase price:</strong> ${String(purchase.purchase_price)}{" "}
          {String(purchase.currency)}
        </p>
        <p>
          <strong>Purchase date:</strong> {String(purchase.purchase_date)}
        </p>
        <p>
          <strong>Deadline:</strong> {String(purchase.monitoring_deadline ?? "—")}
        </p>
        {fingerprint ? (
          <p data-testid="fingerprint-id">
            <strong>Locked fingerprint:</strong> {String(fingerprint.fingerprint_id)}
          </p>
        ) : (
          <p className="muted">No locked fingerprint yet.</p>
        )}
      </div>

      {monitoring ? (
        <form className="card" action={runCheckAction} data-testid="run-check-form">
          <h2>Run price check</h2>
          <p className="muted">
            Demo check uses a <strong>fixture</strong> lower observed Target price.
            Not a live SerpApi call. Search budget is still recorded.
          </p>
          <input type="hidden" name="purchase_id" value={id} />
          <button type="submit" data-testid="run-check">
            Run demo price check
          </button>
        </form>
      ) : null}

      <div className="card" data-testid="price-history">
        <h2>Price history</h2>
        {observations.length === 0 ? (
          <p className="muted">No observations yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Price</th>
                <th>Seller</th>
                <th>Provider status</th>
              </tr>
            </thead>
            <tbody>
              {observations.map((o) => (
                <tr key={String(o.id)} data-testid="observation-row">
                  <td>{String(o.observed_at)}</td>
                  <td>
                    {o.observed_price != null
                      ? `$${String(o.observed_price)}`
                      : "—"}
                  </td>
                  <td>{String(o.seller_text)}</td>
                  <td>{String(o.provider_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" data-testid="alerts-list">
        <h2>Alerts</h2>
        {alerts.length === 0 ? (
          <p className="muted">No price-drop alerts.</p>
        ) : (
          <ul>
            {alerts.map((a) => (
              <li key={String(a.id)}>
                <a
                  href={`/purchases/${id}/alerts/${String(a.id)}`}
                  data-testid="alert-link"
                >
                  Potential recovery ${String(a.potential_recovery)} (observed $
                  {String(a.observed_price)})
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Monitor runs</h2>
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Outcome</th>
                <th>Skip</th>
                <th>Searches</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={String(r.id)}>
                  <td>{String(r.finished_at)}</td>
                  <td>{String(r.outcome)}</td>
                  <td>{String(r.skip_reason ?? "—")}</td>
                  <td>{String(r.searches_consumed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
