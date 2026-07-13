import { runCheckAction } from "@/web/actions";
import { dashboardError } from "@/web/error-copy";
import {
  daysRemaining,
  formatUsd,
  statusLabel,
  statusTone,
} from "@/web/status-copy";
import { getPurchaseDetail } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { notFound } from "next/navigation";
import {
  Button,
  Card,
  DemoDataBanner,
  FormError,
  InlineNotice,
  PageHeader,
  StatusBadge,
} from "@/ui";

export default async function PurchaseDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await prepareWebDatabase();
  const detail = getPurchaseDetail(id);
  if (!detail) notFound();

  const { purchase, fingerprint, observations, alerts, runs } = detail;
  const status = String(purchase.status);
  const monitoring =
    purchase.status === "MONITORING_ACTIVE" && purchase.fingerprint_id;
  const remaining = daysRemaining(
    purchase.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
  );
  const latest = observations[0];
  const productTitle =
    (fingerprint?.product_title as string | undefined) ||
    (latest?.product_title as string | undefined) ||
    "Your purchase";
  const err = sp.error ? dashboardError(sp.error) : null;

  return (
    <div className="n-screen">
      <PageHeader
        eyebrow="Purchase"
        title={productTitle}
        description="What Nobu is watching and the latest observed price."
      />

      <DemoDataBanner data-testid="fixture-banner">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current retailer price.
        </p>
      </DemoDataBanner>

      {sp.checked ? (
        <InlineNotice tone="success" data-testid="check-complete">
          <p>Price check completed. See history and any alerts below.</p>
        </InlineNotice>
      ) : null}

      {err ? (
        <FormError data-testid="dashboard-error" title={err.heading}>
          <p>{err.body}</p>
          <p>
            <strong>Next:</strong> {err.nextAction}
          </p>
        </FormError>
      ) : null}

      <Card data-testid="purchase-status" className="n-status-card">
        <div className="n-status-card__head">
          <StatusBadge
            label={statusLabel(status)}
            tone={statusTone(status)}
            data-testid="status-pill"
          />
          <span className="visually-hidden" data-testid="status-code">
            {status}
          </span>
        </div>

        <dl className="n-kv n-kv--grid">
          <div>
            <dt>Retailer</dt>
            <dd data-testid="retailer-value">Target</dd>
          </div>
          <div>
            <dt>Purchase price</dt>
            <dd>{formatUsd(String(purchase.purchase_price))}</dd>
          </div>
          <div>
            <dt>Latest observed price</dt>
            <dd>
              {latest?.observed_price != null
                ? formatUsd(String(latest.observed_price))
                : "Not checked yet"}
            </dd>
          </div>
          <div>
            <dt>Monitoring window</dt>
            <dd>
              {remaining != null
                ? `${remaining} day${remaining === 1 ? "" : "s"} remaining`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd>
              {latest?.observed_at
                ? String(latest.observed_at)
                : "Not checked yet"}
            </dd>
          </div>
        </dl>

        {fingerprint ? (
          <p className="muted" data-testid="fingerprint-id">
            Locked product identity on file
            <span className="visually-hidden">
              {" "}
              {String(fingerprint.fingerprint_id)}
            </span>
          </p>
        ) : (
          <InlineNotice tone="warning">
            <p>
              Confirm the exact product before watching.{" "}
              <a href={`/purchases/${id}/review`}>Review candidates</a>
            </p>
          </InlineNotice>
        )}

        <p className="muted n-break">
          Link: {String(purchase.target_product_url)}
        </p>
      </Card>

      {monitoring ? (
        <form
          className="n-card"
          action={runCheckAction}
          data-testid="run-check-form"
        >
          <h2 className="n-card-title">Check the price</h2>
          <p className="muted">
            Demo check uses a fixture lower observed Target price — not a live
            shopping call. Search budget is still recorded.
          </p>
          <input type="hidden" name="purchase_id" value={id} />
          <Button type="submit" block data-testid="run-check">
            Check for a lower price
          </Button>
        </form>
      ) : null}

      <Card data-testid="price-history">
        <h2 className="n-card-title">Price history</h2>
        {observations.length === 0 ? (
          <p className="muted">
            No price checks yet. Run a check when watching is active.
          </p>
        ) : (
          <ul className="n-history-list">
            {observations.map((o) => (
              <li key={String(o.id)} data-testid="observation-row">
                <strong>
                  {o.observed_price != null
                    ? formatUsd(String(o.observed_price))
                    : "No price"}
                </strong>
                <span className="muted"> · {String(o.observed_at)}</span>
                <div className="muted">{String(o.seller_text)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-testid="alerts-list">
        <h2 className="n-card-title">Price updates</h2>
        {alerts.length === 0 ? (
          <p className="muted">No price-drop alerts yet.</p>
        ) : (
          <ul className="n-list">
            {alerts.map((a) => (
              <li key={String(a.id)}>
                <a
                  href={`/purchases/${id}/alerts/${String(a.id)}`}
                  data-testid="alert-link"
                >
                  Possible difference {formatUsd(String(a.potential_recovery))}{" "}
                  (observed {formatUsd(String(a.observed_price))})
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="n-disclosure">
        <summary className="n-disclosure__summary">
          <span>Check history (advanced)</span>
        </summary>
        <div className="n-disclosure__body">
          {runs.length === 0 ? (
            <p className="muted">No monitor runs yet.</p>
          ) : (
            <ul className="n-history-list">
              {runs.map((r) => (
                <li key={String(r.id)}>
                  {String(r.finished_at)} · {String(r.outcome)}
                  {r.skip_reason ? ` · ${String(r.skip_reason)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
