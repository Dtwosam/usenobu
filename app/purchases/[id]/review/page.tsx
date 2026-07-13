import { confirmCandidateAction } from "@/web/actions";
import { getPurchaseDetail } from "@/web/purchase-service";
import { buildFixtureOffers, FIXTURE_BANNER } from "@/web/fixtures";
import { evaluateProductMatches } from "@/matching/index";
import { notFound } from "next/navigation";

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

  return (
    <div>
      <h1>Review product candidates</h1>
      <div className="banner-fixture" data-testid="fixture-banner">
        {FIXTURE_BANNER}
      </div>

      {sp.error ? (
        <div className="banner-warn" data-testid="review-error">
          Confirmation blocked: {sp.error}
        </div>
      ) : null}

      <div className="card">
        <h2>Your purchase</h2>
        <p>
          <strong>URL:</strong> {String(purchase.target_product_url)}
        </p>
        <p>
          <strong>Paid:</strong> ${String(purchase.purchase_price)}{" "}
          {String(purchase.currency)} on {String(purchase.purchase_date)}
        </p>
        <p className="muted">
          Match decision:{" "}
          <span className="pill warn" data-testid="match-decision">
            {evaluation.decision}
          </span>
        </p>
        <p className="muted" data-testid="match-reasons">
          Reasons: {evaluation.reasons.join(", ")}
        </p>
      </div>

      <div className="card" data-testid="candidates-card">
        <h2>Target candidates (fixture)</h2>
        {evaluation.candidates.length === 0 ? (
          <p data-testid="no-candidates">
            No Target candidates available. Monitoring cannot start without a confirmed
            exact match.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Seller</th>
                <th>Price</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              {evaluation.candidates.map((c) => (
                <tr key={c.candidate_id} data-testid="candidate-row">
                  <td>{c.offer.title}</td>
                  <td>{c.offer.seller_text}</td>
                  <td>
                    {c.offer.observed_price != null
                      ? `$${c.offer.observed_price}`
                      : "—"}
                  </td>
                  <td>
                    {c.tier}
                    {c.title_only ? " (title-only)" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {canConfirm && evaluation.exact_candidate ? (
        <form className="card" action={confirmCandidateAction} data-testid="confirm-form">
          <h2>Confirm exact product</h2>
          <p>
            Confirming locks a product fingerprint. Later checks use only that
            fingerprint. Title-only or ambiguous matches cannot be confirmed.
          </p>
          <p>
            <strong data-testid="confirm-title">
              {evaluation.exact_candidate.offer.title}
            </strong>
          </p>
          <input type="hidden" name="purchase_id" value={id} />
          <input
            type="hidden"
            name="candidate_json"
            value={JSON.stringify(evaluation.exact_candidate)}
          />
          <button type="submit" data-testid="confirm-candidate">
            Confirm and start monitoring
          </button>
        </form>
      ) : (
        <div className="banner-warn" data-testid="cannot-confirm">
          {evaluation.decision === "MATCH_REVIEW_REQUIRED"
            ? "Match review required — ambiguous or insufficient identity. Monitoring will not start."
            : "No exact Target candidate to confirm."}
        </div>
      )}

      <p className="muted">
        Prices shown are third-party observations (fixture in demo), not official Target
        API prices. Target makes the final adjustment decision.
      </p>
    </div>
  );
}
