import { confirmCandidateAction } from "@/web/actions";
import { reviewError } from "@/web/error-copy";
import { formatUsd, matchDecisionLabel } from "@/web/status-copy";
import { getPurchaseDetail } from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { getWebDatabase } from "@/web/db";
import { loadEnrollmentDiscovery } from "@/web/discovery-store";
import { enrollmentAmbiguityCopy } from "@/web/ambiguity-copy";
import { redirect } from "next/navigation";
import {
  Button,
  Card,
  DemoDataBanner,
  FormError,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Stepper,
} from "@/ui";

export default async function ReviewPage({
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
  // Missing purchase after redirect = session cookie not available (multi-instance).
  // Never show a bare Next.js 404 for a broken navigation.
  if (!detail) {
    redirect("/purchases/new?error=session_lost");
  }

  const purchase = detail.purchase;
  const db = getWebDatabase();
  let discovery = null as ReturnType<typeof loadEnrollmentDiscovery>;
  try {
    discovery = loadEnrollmentDiscovery(db, id);
  } catch {
    discovery = null;
  }

  const evaluation = discovery?.evaluation ?? null;
  const dataSource = discovery?.data_source ?? "LIVE";
  const isFixture = dataSource === "FIXTURE";

  const exact = evaluation?.exact_candidate;
  const canConfirm =
    Boolean(evaluation) &&
    evaluation!.decision === "EXACT_MATCH_CANDIDATE" &&
    Boolean(exact) &&
    !exact!.title_only;

  const hasSelectableCandidates = Boolean(
    evaluation?.candidates.some(
      (c) => c.decision === "EXACT_MATCH_CANDIDATE" && !c.title_only,
    ),
  );
  const isAmbiguous = evaluation?.decision === "MATCH_REVIEW_REQUIRED";
  const noCandidates = !evaluation || evaluation.candidates.length === 0;
  const err = sp.error ? reviewError(sp.error) : null;
  const ambiguityCopy = isAmbiguous
    ? enrollmentAmbiguityCopy({
        reasons: evaluation?.reasons ?? [],
        has_tcin: Boolean(purchase.target_item_id),
        has_model: Boolean(purchase.model_number),
        has_upc: Boolean(purchase.upc_or_gtin),
        has_target_url: /target\.com/i.test(
          String(purchase.target_product_url ?? ""),
        ),
        candidate_count: evaluation?.candidates?.length ?? 0,
      })
    : null;
  const editParams = new URLSearchParams({
    target_product_url: String(purchase.target_product_url ?? ""),
    purchase_price: String(purchase.purchase_price ?? ""),
    purchase_date: String(purchase.purchase_date ?? ""),
    region: String(purchase.region ?? ""),
    target_item_id: String(purchase.target_item_id ?? ""),
    model_number: String(purchase.model_number ?? ""),
    upc_or_gtin: String(purchase.upc_or_gtin ?? ""),
  });
  const editHref = `/purchases/new?${editParams.toString()}`;

  return (
    <div className="n-screen n-screen--form">
      <PageHeader
        title="Confirm the exact product"
        description="Nobu must confirm the exact item before it can watch the price."
      />

      <Stepper
        steps={[
          { id: "p", label: "Purchase", state: "done" },
          { id: "r", label: "Product", state: "current" },
          { id: "w", label: "Watch", state: "todo" },
        ]}
      />

      {isFixture ? (
        <DemoDataBanner data-testid="fixture-banner">
          <p>
            <strong>Demo data</strong>
            <br />
            This screen uses test fixtures, not a live current Target price.
            <span className="visually-hidden"> DEMO FIXTURE DATA</span>
          </p>
        </DemoDataBanner>
      ) : (
        <p className="visually-hidden" data-testid="live-discovery-source">
          LIVE third-party observation
        </p>
      )}

      {err ? (
        <FormError data-testid="review-error" title={err.heading}>
          <p>{err.body}</p>
          <p>
            <strong>Next:</strong> {err.nextAction}
          </p>
        </FormError>
      ) : null}

      <Card>
        <h2 className="n-card-title">Your purchase</h2>
        <dl className="n-kv">
          <div>
            <dt>Product link</dt>
            <dd className="n-break">{String(purchase.target_product_url)}</dd>
          </div>
          <div>
            <dt>You paid</dt>
            <dd>
              {formatUsd(String(purchase.purchase_price))} on{" "}
              {String(purchase.purchase_date)}
            </dd>
          </div>
        </dl>
        {evaluation ? (
          <p>
            <StatusBadge
              label={matchDecisionLabel(evaluation.decision)}
              tone={
                evaluation.decision === "EXACT_MATCH_CANDIDATE"
                  ? "success"
                  : "warning"
              }
              data-testid="match-decision-label"
            />
            <span
              className="visually-hidden"
              data-testid="match-decision"
              data-decision={evaluation.decision}
            >
              {evaluation.decision}
            </span>
          </p>
        ) : null}
        <p className="muted visually-hidden" data-testid="match-reasons">
          Reasons: {evaluation?.reasons?.join(", ") ?? "none"}
        </p>
        <p className="visually-hidden" data-testid="discovery-data-source">
          {dataSource}
        </p>
        {discovery?.diagnostics ? (
          <pre
            className="visually-hidden"
            data-testid="discovery-diagnostics"
          >
            {JSON.stringify(discovery.diagnostics)}
          </pre>
        ) : null}
      </Card>

      {isAmbiguous && ambiguityCopy ? (
        <InlineNotice tone="warning" data-testid="ambiguous-notice">
          <h2 className="n-notice-heading">{ambiguityCopy.heading}</h2>
          <p data-testid="ambiguous-body">{ambiguityCopy.body}</p>
          <p>
            <a href={editHref}>Edit purchase details</a>
          </p>
        </InlineNotice>
      ) : null}

      <Card data-testid="candidates-card">
        <h2 className="n-card-title">Target product candidates</h2>
        {noCandidates ? (
          <div data-testid="no-candidates">
            <h3 className="n-empty-inline-title">
              Nobu could not find a reliable Target product right now.
            </h3>
            <p>
              Monitoring can’t start without a confirmed exact match.
            </p>
            <p>
              <strong>Next:</strong> Retry later, or add the model number or UPC
              if Nobu asks for one. <a href={editHref}>Edit purchase details</a>.
            </p>
          </div>
        ) : (
          <ul className="n-candidate-list">
            {evaluation!.candidates.map((c) => (
              <li
                key={c.candidate_id}
                className="n-candidate"
                data-testid="candidate-row"
                data-tier={c.tier}
              >
                <div className="n-candidate__main">
                  {c.offer.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.offer.thumbnail}
                      alt=""
                      className="n-candidate__image"
                      data-testid="candidate-image"
                    />
                  ) : (
                    <p className="muted" data-testid="candidate-image-missing">
                      Image unavailable
                    </p>
                  )}
                  <strong>{c.offer.title}</strong>
                  <p className="muted">Seller: {c.offer.seller_text}</p>
                  <ul className="n-meta-list">
                    <li>
                      Observed price:{" "}
                      {c.offer.observed_price != null
                        ? formatUsd(c.offer.observed_price)
                        : "—"}
                    </li>
                    {c.offer.model_number || c.matched_model ? (
                      <li>
                        Model: {c.matched_model || c.offer.model_number}
                      </li>
                    ) : null}
                    {c.matched_tcin || c.offer.target_item_id ? (
                      <li>
                        TCIN: {c.matched_tcin || c.offer.target_item_id}
                      </li>
                    ) : null}
                  </ul>
                  <details className="n-disclosure">
                    <summary className="n-disclosure__summary">
                      View details
                    </summary>
                    <div className="n-disclosure__body muted">
                      <p>
                        Source: third-party shopping observation (SerpApi Google
                        Shopping) — not an official Target API.
                      </p>
                      <p>Candidate id: {c.candidate_id}</p>
                      <p>Seller: {c.offer.seller_text}</p>
                      <p>Observed at: {c.offer.observed_at || discovery?.created_at || "unknown"}</p>
                      <p>Data source: {dataSource}</p>
                      <p>
                        Target URL: {c.offer.merchant_link || c.offer.link || c.offer.product_link ? (
                          <a
                            href={c.offer.merchant_link || c.offer.link || c.offer.product_link || "#"}
                            data-testid="candidate-url"
                          >
                            View observed offer
                          </a>
                        ) : (
                          "unavailable"
                        )}
                      </p>
                      {c.offer.size || c.offer.color || c.offer.weight || c.offer.quantity ? (
                        <p>
                          Variant: {[c.offer.size, c.offer.color, c.offer.weight, c.offer.quantity]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      ) : null}
                      {c.offer.upc_or_gtin ? (
                        <p>UPC: {c.offer.upc_or_gtin}</p>
                      ) : null}
                      {c.title_only ? (
                        <p>Title-only match (cannot confirm)</p>
                      ) : null}
                      <p>Match: {c.reasons.join(", ")}</p>
                    </div>
                  </details>
                </div>
                {c.decision === "EXACT_MATCH_CANDIDATE" && !c.title_only ? (
                  <form action={confirmCandidateAction} className="n-candidate__action">
                    <input type="hidden" name="purchase_id" value={id} />
                    <input
                      type="hidden"
                      name="candidate_id"
                      value={c.candidate_id}
                    />
                    <Button type="submit" data-testid="confirm-candidate-row">
                      Select this product
                    </Button>
                  </form>
                ) : null}
                <StatusBadge
                  label={
                    c.decision === "EXACT_MATCH_CANDIDATE" && !c.title_only
                      ? "Ready to confirm"
                      : c.title_only
                        ? "Too weak"
                        : "Needs review"
                  }
                  tone={
                    c.decision === "EXACT_MATCH_CANDIDATE" && !c.title_only
                      ? "success"
                      : "warning"
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canConfirm && evaluation?.exact_candidate ? (
        <form
          className="n-card n-confirm-card"
          action={confirmCandidateAction}
          data-testid="confirm-form"
        >
          <h2 className="n-card-title">Start watching this exact product?</h2>
          <p>
            <strong data-testid="confirm-title">
              {evaluation.exact_candidate.offer.title}
            </strong>
          </p>
          <p className="muted">
            Confirming locks this product. Later checks use only that locked
            identity.
          </p>
          <input type="hidden" name="purchase_id" value={id} />
          <input
            type="hidden"
            name="candidate_id"
            value={evaluation.exact_candidate.candidate_id}
          />
          <Button type="submit" block data-testid="confirm-candidate">
            Confirm product
          </Button>
        </form>
      ) : hasSelectableCandidates ? null : (
        <div className="n-notice n-notice--warning" data-testid="cannot-confirm">
          <div>
            <strong>
              {isAmbiguous && ambiguityCopy
                ? ambiguityCopy.heading
                : noCandidates
                  ? "No product to confirm"
                  : "This match can’t be confirmed yet"}
            </strong>
            <p data-testid="cannot-confirm-body">
              {isAmbiguous && ambiguityCopy
                ? ambiguityCopy.body
                : "Monitoring will not start until Nobu can lock one exact Target product."}
            </p>
            {isAmbiguous && ambiguityCopy ? (
              <p className="muted">{ambiguityCopy.nextAction}</p>
            ) : null}
          </div>
        </div>
      )}

      <InlineNotice tone="info">
        <p>
          Prices are third-party shopping observations, not official Target
          prices. Target makes the final adjustment decision.
        </p>
      </InlineNotice>
    </div>
  );
}
