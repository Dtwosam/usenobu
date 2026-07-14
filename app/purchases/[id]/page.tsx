import { runCheckAction } from "@/web/actions";
import {
  checkOutcomeMessage,
  decisionBannerMessage,
  alertActionLabel,
  suppressionReasonLabel,
  type CheckOutcomeCode,
} from "@/web/check-outcome";
import { dashboardError } from "@/web/error-copy";
import {
  canOfferManualCheck,
  countCompletedProviderChecks,
  formatCheckedAt,
  hasSearchBudget,
  isCooldownActive,
  lastAttemptedCheckAt,
  lastSuccessfulCheckAt,
  monitoringStatusLabel,
  shouldShowFixtureUiLabel,
  FIXTURE_UI_LABEL,
} from "@/web/manual-check";
import {
  daysRemaining,
  formatUsd,
  statusLabel,
  statusTone,
} from "@/web/status-copy";
import { getPurchaseDetail } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { getWebDatabase } from "@/web/db";
import { notFound } from "next/navigation";
import {
  Card,
  DemoDataBanner,
  Disclosure,
  FormError,
  InlineNotice,
  PageHeader,
  PriceSummary,
  StatusBadge,
} from "@/ui";
import { CheckPriceButton } from "./CheckPriceButton";

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

  const db = getWebDatabase();
  const { purchase, fingerprint, observations, alerts, runs } = detail;
  const status = String(purchase.status);
  const remaining = daysRemaining(
    purchase.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
  );
  const latest = observations.find((o) => o.observed_price != null) ?? observations[0];
  const productTitle =
    (fingerprint?.product_title as string | undefined) ||
    (latest?.product_title as string | undefined) ||
    "Your purchase";

  const cooldownActive = isCooldownActive(db, id);
  const budgetOk = hasSearchBudget(db);
  const showCheck = canOfferManualCheck({
    status,
    fingerprint_id: purchase.fingerprint_id
      ? String(purchase.fingerprint_id)
      : null,
    monitoring_deadline: purchase.monitoring_deadline
      ? String(purchase.monitoring_deadline)
      : null,
    cooldownActive,
    budgetOk,
  });

  const completedChecks = countCompletedProviderChecks(runs);
  const lastAttempted = lastAttemptedCheckAt(runs);
  const lastSuccessful = lastSuccessfulCheckAt(runs);
  const latestRun = runs[0] as Record<string, unknown> | undefined;

  const outcomeCode = (sp.outcome as CheckOutcomeCode | undefined) ?? null;
  const outcomeMsg = outcomeCode ? checkOutcomeMessage(outcomeCode) : null;
  const err = sp.error ? dashboardError(sp.error) : null;

  const purchasePrice = Number(purchase.purchase_price);
  const latestPrice =
    latest?.observed_price != null ? Number(latest.observed_price) : null;
  const potentialDiff =
    latestPrice != null && Number.isFinite(purchasePrice) && latestPrice < purchasePrice
      ? Math.round((purchasePrice - latestPrice) * 100) / 100
      : null;

  const showPriceDropFacts =
    outcomeCode === "price_drop" ||
    (potentialDiff != null && potentialDiff > 0 && alerts.length > 0);

  const decisionLine =
    outcomeMsg ??
    (latestRun
      ? decisionBannerMessage({
          outcome: latestRun.outcome ? String(latestRun.outcome) : null,
          match_result: latestRun.match_result
            ? String(latestRun.match_result)
            : null,
          notes: latestRun.notes ? String(latestRun.notes) : null,
          alert_created: Boolean(latestRun.alert_id),
        })
      : null);

  return (
    <div className="n-screen">
      <PageHeader
        eyebrow="Purchase"
        title={productTitle}
        description="What Nobu is watching."
      />

      {shouldShowFixtureUiLabel() ? (
        <DemoDataBanner data-testid="fixture-banner">
          <p data-testid="fixture-label">
            <strong>Demo data</strong>
            <br />
            {FIXTURE_UI_LABEL}
          </p>
        </DemoDataBanner>
      ) : null}

      {outcomeMsg && !err ? (
        <InlineNotice
          tone={outcomeCode === "price_drop" ? "success" : "info"}
          data-testid="check-complete"
        >
          <p data-testid="check-outcome">{outcomeMsg}</p>
        </InlineNotice>
      ) : null}

      {err ? (
        <FormError data-testid="dashboard-error" title={err.heading}>
          <p>{err.body}</p>
        </FormError>
      ) : null}

      {/* Compact Monitoring Proof — default surface */}
      <Card data-testid="monitoring-proof" className="n-status-card">
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

        <p className="muted n-proof-support" data-testid="proof-support">
          {fingerprint
            ? "Nobu is watching the exact product you confirmed."
            : "Confirm the exact product before watching."}
        </p>

        <dl className="n-kv n-kv--grid" data-testid="proof-facts">
          <div>
            <dt>Monitoring status</dt>
            <dd data-testid="monitoring-status">
              {monitoringStatusLabel(status)}
            </dd>
          </div>
          <div>
            <dt>Purchase price</dt>
            <dd data-testid="purchase-price">
              {formatUsd(String(purchase.purchase_price))}
            </dd>
          </div>
          <div>
            <dt>Latest accepted price</dt>
            <dd data-testid="latest-price">
              {latest?.observed_price != null
                ? formatUsd(String(latest.observed_price))
                : "Not checked yet"}
            </dd>
          </div>
          <div>
            <dt>Last checked</dt>
            <dd data-testid="last-checked">
              {formatCheckedAt(
                lastSuccessful ??
                  (latest?.observed_at ? String(latest.observed_at) : null),
              )}
            </dd>
          </div>
          <div>
            <dt>Days remaining</dt>
            <dd data-testid="days-remaining">
              {remaining != null
                ? `${remaining} day${remaining === 1 ? "" : "s"}`
                : "—"}
            </dd>
          </div>
        </dl>

        {fingerprint ? (
          <p className="visually-hidden" data-testid="fingerprint-id">
            Locked product identity on file {String(fingerprint.fingerprint_id)}
          </p>
        ) : (
          <InlineNotice tone="warning">
            <p>
              Confirm the exact product before watching.{" "}
              <a href={`/purchases/${id}/review`}>Review candidates</a>
            </p>
          </InlineNotice>
        )}

        {showCheck ? (
          <div className="n-proof-action">
            <CheckPriceButton purchaseId={id} action={runCheckAction} />
          </div>
        ) : null}

        {showPriceDropFacts && potentialDiff != null ? (
          <div className="n-proof-diff" data-testid="price-drop-facts">
            <PriceSummary
              purchasePriceLabel="Purchase price"
              purchasePrice={formatUsd(purchasePrice)}
              observedPriceLabel="Latest accepted price"
              observedPrice={
                latestPrice != null ? formatUsd(latestPrice) : undefined
              }
              differenceLabel="Potential difference"
              difference={formatUsd(potentialDiff)}
              note={
                remaining != null
                  ? `${remaining} day${remaining === 1 ? "" : "s"} remaining`
                  : undefined
              }
            />
            <p className="muted n-trust-note" data-testid="trust-note">
              Third-party observed price. Target verifies and decides.
            </p>
          </div>
        ) : null}

        {decisionLine && !outcomeMsg ? (
          <p className="muted" data-testid="decision-line">
            {decisionLine}
          </p>
        ) : null}

        <Disclosure title="View details">
          <dl className="n-kv" data-testid="proof-details">
            <div>
              <dt>Monitoring start</dt>
              <dd data-testid="monitoring-start">
                {fingerprint?.confirmed_at
                  ? formatCheckedAt(String(fingerprint.confirmed_at))
                  : fingerprint && purchase.updated_at
                    ? formatCheckedAt(String(purchase.updated_at))
                    : "—"}
              </dd>
            </div>
            <div>
              <dt>Monitoring deadline</dt>
              <dd>
                {purchase.monitoring_deadline
                  ? String(purchase.monitoring_deadline)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Completed checks</dt>
              <dd data-testid="completed-check-count">{completedChecks}</dd>
            </div>
            <div>
              <dt>Last attempted check</dt>
              <dd data-testid="last-attempted">
                {formatCheckedAt(lastAttempted)}
              </dd>
            </div>
            <div>
              <dt>Last successful check</dt>
              <dd data-testid="last-successful">
                {formatCheckedAt(lastSuccessful)}
              </dd>
            </div>
            <div>
              <dt>Provider outcome</dt>
              <dd data-testid="provider-outcome">
                {latestRun?.provider_status
                  ? String(latestRun.provider_status)
                  : latestRun?.outcome
                    ? String(latestRun.outcome)
                    : "—"}
              </dd>
            </div>
            {sp.data_source === "LIVE" || sp.data_source === "FIXTURE" ? (
              <div>
                <dt>Price source</dt>
                <dd data-testid="price-data-source">
                  {sp.data_source === "LIVE"
                    ? "Third-party SerpApi observation (live)"
                    : "Test fixture (not live)"}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Matching decision</dt>
              <dd data-testid="matching-decision">
                {latestRun?.match_result
                  ? String(latestRun.match_result)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Policy result</dt>
              <dd data-testid="policy-result">{statusLabel(status)}</dd>
            </div>
            <div>
              <dt>Alert</dt>
              <dd data-testid="alert-action">
                {latestRun ? alertActionLabel(latestRun) : "No alert"}
              </dd>
            </div>
            {latestRun && suppressionReasonLabel(latestRun) ? (
              <div>
                <dt>Suppression reason</dt>
                <dd data-testid="suppression-reason">
                  {suppressionReasonLabel(latestRun)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Full last-check timestamp</dt>
              <dd>
                {lastAttempted ? String(lastAttempted) : "—"}
              </dd>
            </div>
            {/* Never invent next check — only if a stored field exists */}
            {"next_check_at" in purchase && purchase.next_check_at ? (
              <div>
                <dt>Next scheduled check</dt>
                <dd data-testid="next-check">
                  {String(purchase.next_check_at)}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="muted">
            Retailer: Target · Link:{" "}
            <span className="n-break">
              {String(purchase.target_product_url)}
            </span>
          </p>
        </Disclosure>
      </Card>

      {alerts.length > 0 ? (
        <Card data-testid="alerts-list">
          <h2 className="n-card-title">Price updates</h2>
          <ul className="n-list">
            {alerts.map((a) => (
              <li key={String(a.id)}>
                <a
                  href={`/purchases/${id}/alerts/${String(a.id)}`}
                  data-testid="alert-link"
                >
                  Possible difference {formatUsd(String(a.potential_recovery))}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
