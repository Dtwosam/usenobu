import { reviewError } from "@/web/error-copy";
import { matchDecisionLabel } from "@/web/status-copy";
import {
  getPurchaseDetail,
  USER_PROVIDED_PURCHASE_IDENTITY_REASON,
} from "@/web/purchase-service";
import { prepareWebDatabase } from "@/web/prepare-db";
import { getWebDatabase } from "@/web/db";
import { loadEnrollmentDiscovery } from "@/web/discovery-store";
import { isStrongMatchTier } from "@/matching/rules";
import { redirect } from "next/navigation";
import {
  Card,
  DemoDataBanner,
  FormError,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Stepper,
} from "@/ui";
import {
  CandidateSelection,
  NoResultsState,
  type ReviewCandidate,
} from "./CandidateSelection";

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
  const strongCandidates = (evaluation?.candidates ?? []).filter(
    (c) =>
      c.decision === "EXACT_MATCH_CANDIDATE" &&
      !c.title_only &&
      isStrongMatchTier(c.tier),
  );
  const isSingleStrong =
    evaluation?.decision === "EXACT_MATCH_CANDIDATE" &&
    Boolean(exact) &&
    !exact!.title_only &&
    strongCandidates.length === 1;
  const isMulti =
    !isSingleStrong &&
    (evaluation?.decision === "MATCH_REVIEW_REQUIRED" ||
      strongCandidates.length > 1) &&
    (evaluation?.candidates?.length ?? 0) > 0;
  const noCandidates = !evaluation || evaluation.candidates.length === 0;
  const err = sp.error ? reviewError(sp.error) : null;

  const editParams = new URLSearchParams({
    target_product_url: /pending-identity/i.test(
      String(purchase.target_product_url ?? ""),
    )
      ? ""
      : String(purchase.target_product_url ?? ""),
    purchase_price: String(purchase.purchase_price ?? ""),
    purchase_date: String(purchase.purchase_date ?? ""),
    region: String(purchase.region ?? ""),
    target_item_id: String(purchase.target_item_id ?? ""),
    model_number: String(purchase.model_number ?? ""),
    upc_or_gtin: String(purchase.upc_or_gtin ?? ""),
    product_title: String(sp.title ?? ""),
  });
  const editHref = `/purchases/new?${editParams.toString()}`;

  const reviewCandidates: ReviewCandidate[] = (evaluation?.candidates ?? [])
    .filter((c) => c.offer.seller_kind === "target" && !c.offer.is_target_plus)
    .slice(0, 5)
    .map((c) => ({
      candidate_id: c.candidate_id,
      title: c.offer.title,
      thumbnail: c.offer.thumbnail ?? null,
      observed_price:
        c.offer.observed_price != null ? Number(c.offer.observed_price) : null,
      currency: c.offer.currency ?? "USD",
      seller_text: c.offer.seller_text,
      target_item_id: c.matched_tcin || c.offer.target_item_id || null,
      model_number: c.matched_model || c.offer.model_number || null,
      upc_or_gtin: c.matched_upc || c.offer.upc_or_gtin || null,
      color: c.offer.color ?? null,
      size: c.offer.size ?? null,
      quantity: c.offer.quantity ?? null,
      title_only: Boolean(c.title_only),
      strong:
        c.decision === "EXACT_MATCH_CANDIDATE" &&
        !c.title_only &&
        isStrongMatchTier(c.tier),
      source_note: c.reasons.includes(USER_PROVIDED_PURCHASE_IDENTITY_REASON)
        ? "User-provided exact Target identity — no current price observed yet. Not an official Target API price."
        : "Third-party Google Shopping observation via SerpApi. Not an official Target API price.",
    }));

  return (
    <div className="n-screen n-screen--form n-screen--review">
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
            <dt>You paid</dt>
            <dd>
              ${Number(purchase.purchase_price).toFixed(2)} on{" "}
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

      {noCandidates ? (
        <div data-testid="cannot-confirm">
          <NoResultsState editHref={editHref} />
          <p className="visually-hidden" data-testid="cannot-confirm-body">
            Monitoring will not start until Nobu can lock one exact Target product.
          </p>
        </div>
      ) : isSingleStrong || isMulti ? (
        <CandidateSelection
          purchaseId={id}
          candidates={
            isSingleStrong && exact
              ? reviewCandidates.filter(
                  (c) => c.candidate_id === exact.candidate_id,
                )
              : reviewCandidates
          }
          editHref={editHref}
          singleStrong={isSingleStrong}
        />
      ) : (
        <div className="n-notice n-notice--warning" data-testid="cannot-confirm">
          <div>
            <strong>This match can’t be confirmed yet</strong>
            <p data-testid="cannot-confirm-body">
              Monitoring will not start until Nobu can lock one exact Target product.
            </p>
            <p>
              <a href={editHref}>Edit product details</a>
            </p>
          </div>
        </div>
      )}

      <InlineNotice tone="info">
        <p>
          When shown, prices are third-party shopping observations, not official Target prices. Identity-only confirmations still require later price observations to match the locked fingerprint. Target makes the final adjustment decision.
        </p>
      </InlineNotice>
    </div>
  );
}
