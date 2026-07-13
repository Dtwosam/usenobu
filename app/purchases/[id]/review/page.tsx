import { confirmCandidateAction } from "@/web/actions";
import { reviewError } from "@/web/error-copy";
import { formatUsd, matchDecisionLabel } from "@/web/status-copy";
import { getPurchaseDetail } from "@/web/purchase-service";
import { buildFixtureOffers } from "@/web/fixtures";
import { evaluateProductMatches } from "@/matching/index";
import { notFound } from "next/navigation";
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
  const detail = getPurchaseDetail(id);
  if (!detail) notFound();

  const purchase = detail.purchase;
  const scenario = (sp.scenario ?? "exact_match") as
    | "exact_match"
    | "ambiguous"
    | "no_price";
  const title = sp.title || undefined;

  const offers = buildFixtureOffers({
    scenario,
    target_product_url: String(purchase.target_product_url),
    target_item_id: (purchase.target_item_id as string) || undefined,
    model_number: (purchase.model_number as string) || undefined,
    product_title: title,
  });

  const evaluation = evaluateProductMatches(
    {
      purchase_id: id,
      target_product_url: String(purchase.target_product_url),
      target_item_id: (purchase.target_item_id as string) || null,
      model_number: (purchase.model_number as string) || null,
      upc_or_gtin: (purchase.upc_or_gtin as string) || null,
      product_title: title,
    },
    offers,
  );

  const canConfirm =
    evaluation.decision === "EXACT_MATCH_CANDIDATE" &&
    evaluation.exact_candidate &&
    !evaluation.exact_candidate.title_only;

  const isAmbiguous = evaluation.decision === "MATCH_REVIEW_REQUIRED";
  const noCandidates = evaluation.candidates.length === 0;
  const err = sp.error ? reviewError(sp.error) : null;

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

      <DemoDataBanner data-testid="fixture-banner">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current Target price.
          <span className="visually-hidden"> DEMO FIXTURE DATA</span>
        </p>
      </DemoDataBanner>

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
          {/* Machine-readable decision for tests — not shown as primary copy */}
          <span
            className="visually-hidden"
            data-testid="match-decision"
            data-decision={evaluation.decision}
          >
            {evaluation.decision}
          </span>
        </p>
        <p className="muted visually-hidden" data-testid="match-reasons">
          Reasons: {evaluation.reasons.join(", ")}
        </p>
      </Card>

      {isAmbiguous ? (
        <InlineNotice tone="warning" data-testid="ambiguous-notice">
          <h2 className="n-notice-heading">We need a little more detail</h2>
          <p>
            We found more than one possible Target product. Add a model, TCIN or
            UPC so Nobu can avoid choosing the wrong item.
          </p>
          <p>
            <a href="/purchases/new">Edit purchase details</a>
          </p>
        </InlineNotice>
      ) : null}

      <Card data-testid="candidates-card">
        <h2 className="n-card-title">Target product candidates</h2>
        {noCandidates ? (
          <div data-testid="no-candidates">
            <h3 className="n-empty-inline-title">No Target product found</h3>
            <p>
              We couldn’t find a reliable Target candidate from this search. Monitoring
              can’t start without a confirmed exact match.
            </p>
            <p>
              <strong>Next:</strong> Double-check the product link, model, or TCIN and{" "}
              <a href="/purchases/new">try again</a>.
            </p>
          </div>
        ) : (
          <ul className="n-candidate-list">
            {evaluation.candidates.map((c) => (
              <li
                key={c.candidate_id}
                className="n-candidate"
                data-testid="candidate-row"
                data-tier={c.tier}
              >
                <div className="n-candidate__main">
                  <strong>{c.offer.title}</strong>
                  <p className="muted">
                    Seller: {c.offer.seller_text}
                    {c.offer.is_target_plus ? " · Target Plus (not supported)" : ""}
                  </p>
                  <ul className="n-meta-list">
                    <li>
                      Observed price:{" "}
                      {c.offer.observed_price != null
                        ? formatUsd(c.offer.observed_price)
                        : "—"}
                    </li>
                    {c.offer.model_number ? (
                      <li>Model: {c.offer.model_number}</li>
                    ) : null}
                    {c.matched_tcin || c.offer.target_item_id ? (
                      <li>
                        TCIN: {c.matched_tcin || c.offer.target_item_id}
                      </li>
                    ) : null}
                    {c.offer.upc_or_gtin ? (
                      <li>UPC: {c.offer.upc_or_gtin}</li>
                    ) : null}
                    {c.title_only ? <li>Title-only match (cannot confirm)</li> : null}
                  </ul>
                </div>
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

      {canConfirm && evaluation.exact_candidate ? (
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
            Confirming locks this product. Later checks use only that locked identity —
            not a looser search.
          </p>
          <input type="hidden" name="purchase_id" value={id} />
          <input
            type="hidden"
            name="candidate_json"
            value={JSON.stringify(evaluation.exact_candidate)}
          />
          <Button type="submit" block data-testid="confirm-candidate">
            This is my product
          </Button>
        </form>
      ) : (
        <div className="n-notice n-notice--warning" data-testid="cannot-confirm">
          <div>
            <strong>
              {isAmbiguous
                ? "We need a little more detail"
                : noCandidates
                  ? "No product to confirm"
                  : "This match can’t be confirmed yet"}
            </strong>
            <p>
              {isAmbiguous
                ? "We found more than one possible Target product. Add a model, TCIN or UPC so Nobu can avoid choosing the wrong item."
                : "Monitoring will not start until Nobu can lock one exact Target product."}
            </p>
          </div>
        </div>
      )}

      <InlineNotice tone="info">
        <p>
          Prices shown are third-party shopping observations (sample data in demo), not
          official Target prices. Target makes the final adjustment decision.
        </p>
      </InlineNotice>
    </div>
  );
}
