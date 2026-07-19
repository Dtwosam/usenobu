"use client";

import { useId, useMemo, useState } from "react";
import { confirmCandidateAction } from "@/web/actions";
import { Button } from "@/ui";
import { formatUsd } from "@/web/status-copy";

export type ReviewCandidate = {
  candidate_id: string;
  title: string;
  thumbnail: string | null;
  observed_price: number | null;
  currency: string;
  seller_text: string;
  target_item_id: string | null;
  model_number: string | null;
  upc_or_gtin: string | null;
  color: string | null;
  size: string | null;
  quantity: string | null;
  title_only: boolean;
  strong: boolean;
  source_note: string;
};

type Props = {
  purchaseId: string;
  candidates: ReviewCandidate[];
  editHref: string;
  /** Single high-confidence candidate path uses simpler confirm UI. */
  singleStrong?: boolean;
};

function identifierChips(c: ReviewCandidate): string[] {
  const chips: string[] = [];
  if (c.target_item_id) chips.push(`TCIN ${c.target_item_id}`);
  if (c.model_number) chips.push(`Model ${c.model_number}`);
  if (c.upc_or_gtin) chips.push(`UPC ${c.upc_or_gtin}`);
  if (c.color) chips.push(`Colour ${c.color}`);
  if (c.size) chips.push(`Size ${c.size}`);
  if (c.quantity) chips.push(`Pack ${c.quantity}`);
  return chips;
}

export function CandidateSelection({
  purchaseId,
  candidates,
  editHref,
  singleStrong = false,
}: Props) {
  const groupId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(
    singleStrong && candidates.length === 1 ? candidates[0]!.candidate_id : null,
  );
  const [stage, setStage] = useState<"select" | "confirm">(
    singleStrong ? "confirm" : "select",
  );

  const selected = useMemo(
    () => candidates.find((c) => c.candidate_id === selectedId) ?? null,
    [candidates, selectedId],
  );

  const strongSelected = Boolean(selected && selected.strong && !selected.title_only);
  const weakSelected = Boolean(selected && (!selected.strong || selected.title_only));

  // --- Final confirmation stage ---
  if (stage === "confirm" && selected && strongSelected) {
    return (
      <div className="n-selection-flow" data-testid="final-confirm-stage">
        <header className="n-selection-header">
          <h2 className="n-selection-heading" data-testid="final-confirm-heading">
            Confirm your product
          </h2>
          <p className="n-selection-support">
            Is this the exact item you purchased?
          </p>
        </header>

        <article
          className="n-candidate-card n-candidate-card--selected"
          data-testid="final-confirm-card"
        >
          <div className="n-candidate-card__media" aria-hidden={!selected.thumbnail}>
            {selected.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.thumbnail}
                alt=""
                className="n-candidate-card__img"
              />
            ) : (
              <span className="n-candidate-card__placeholder" data-testid="candidate-image-missing">
                No image
              </span>
            )}
          </div>
          <div className="n-candidate-card__body">
            <h3 className="n-candidate-card__title" data-testid="confirm-title">
              {selected.title}
            </h3>
            <span className="n-seller-badge">Sold by Target</span>
            <div className="n-candidate-card__price">
              <span className="n-candidate-card__price-label">Observed price</span>
              <span className="n-candidate-card__price-value">
                {selected.observed_price != null
                  ? formatUsd(selected.observed_price)
                  : "No current price observed"}
              </span>
            </div>
            <ul className="n-candidate-card__ids">
              {identifierChips(selected)
                .slice(0, 3)
                .map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
            </ul>
            <p className="n-candidate-card__source">{selected.source_note}</p>
          </div>
        </article>

        <p className="muted n-selection-fingerprint-note">
          Nobu will use this product’s identifiers to avoid matching the wrong item
          during later price checks.
        </p>

        <form action={confirmCandidateAction} className="n-selection-actions">
          <input type="hidden" name="purchase_id" value={purchaseId} />
          <input type="hidden" name="candidate_id" value={selected.candidate_id} />
          <Button type="submit" block data-testid="confirm-candidate">
            Yes, this is my product
          </Button>
          <Button
            type="button"
            variant="secondary"
            block
            data-testid="choose-another-product"
            onClick={() => {
              if (singleStrong) {
                // Single path has nowhere else to go — edit form
                window.location.href = editHref;
                return;
              }
              setStage("select");
            }}
          >
            Choose another product
          </Button>
        </form>
      </div>
    );
  }

  // --- Single strong candidate (initial) ---
  if (singleStrong && candidates.length === 1) {
    const only = candidates[0]!;
    return (
      <div className="n-selection-flow" data-testid="single-result-stage">
        <header className="n-selection-header">
          <h2 className="n-selection-heading" data-testid="single-match-heading">
            Is this the product you purchased?
          </h2>
          <p className="n-selection-support">
            Review the details before Nobu starts monitoring it.
          </p>
        </header>
        <article
          className="n-candidate-card n-candidate-card--selected"
          data-testid="candidate-row"
          data-tier={only.strong ? "strong" : "weak"}
        >
          <div className="n-candidate-card__media">
            {only.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={only.thumbnail}
                alt=""
                className="n-candidate-card__img"
                data-testid="candidate-image"
              />
            ) : (
              <span className="n-candidate-card__placeholder" data-testid="candidate-image-missing">
                No image
              </span>
            )}
          </div>
          <div className="n-candidate-card__body">
            <h3 className="n-candidate-card__title">{only.title}</h3>
            <span className="n-seller-badge">Sold by Target</span>
            <div className="n-candidate-card__price">
              <span className="n-candidate-card__price-label">Observed price</span>
              <span className="n-candidate-card__price-value">
                {only.observed_price != null
                  ? formatUsd(only.observed_price)
                  : "No current price observed"}
              </span>
            </div>
            <ul className="n-candidate-card__ids">
              {identifierChips(only)
                .slice(0, 3)
                .map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
            </ul>
            <p className="n-candidate-card__source">{only.source_note}</p>
          </div>
        </article>
        <div className="n-selection-actions">
          <Button
            type="button"
            block
            data-testid="continue-selected"
            onClick={() => {
              setSelectedId(only.candidate_id);
              setStage("confirm");
            }}
          >
            Continue with this product
          </Button>
          <a className="n-btn n-btn--secondary n-btn--block" href={editHref} data-testid="none-of-these">
            None of these — edit my details
          </a>
        </div>
      </div>
    );
  }

  // --- Multi-candidate selection ---
  const count = candidates.length;

  return (
    <div className="n-selection-flow" data-testid="multi-result-stage">
      <header className="n-selection-header">
        <h2 className="n-selection-heading" data-testid="multi-match-heading">
          Which product did you purchase?
        </h2>
        <p className="n-selection-support" data-testid="multi-match-support">
          We found a few possible matches. Select the exact item you bought.
        </p>
        <p className="n-selection-count" data-testid="match-count">
          {count} possible match{count === 1 ? "" : "es"}
        </p>
      </header>

      <div
        className="n-candidate-grid"
        role="radiogroup"
        aria-labelledby={groupId}
        data-testid="candidates-card"
      >
        <span id={groupId} className="visually-hidden">
          Product candidates
        </span>
        {candidates.map((c) => {
          const isSelected = selectedId === c.candidate_id;
          const chips = identifierChips(c);
          const primary = chips.slice(0, 3);
          const extra = chips.slice(3);
          return (
            <label
              key={c.candidate_id}
              className={[
                "n-candidate-card",
                isSelected ? "n-candidate-card--selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              data-testid="candidate-row"
              data-selected={isSelected ? "true" : "false"}
              data-strong={c.strong && !c.title_only ? "true" : "false"}
            >
              <input
                type="radio"
                className="n-candidate-card__radio"
                name="candidate_choice"
                value={c.candidate_id}
                checked={isSelected}
                onChange={() => setSelectedId(c.candidate_id)}
                data-testid="candidate-radio"
                aria-label={c.title}
              />
              {isSelected ? (
                <span className="n-candidate-card__selected-label" data-testid="candidate-selected-label">
                  Selected
                </span>
              ) : null}
              <div className="n-candidate-card__media">
                {c.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.thumbnail}
                    alt=""
                    className="n-candidate-card__img"
                    data-testid="candidate-image"
                  />
                ) : (
                  <span
                    className="n-candidate-card__placeholder"
                    data-testid="candidate-image-missing"
                  >
                    No image
                  </span>
                )}
              </div>
              <div className="n-candidate-card__body">
                <h3 className="n-candidate-card__title">{c.title}</h3>
                <span className="n-seller-badge">Sold by Target</span>
                <div className="n-candidate-card__price">
                  <span className="n-candidate-card__price-label">
                    Observed price
                  </span>
                  <span className="n-candidate-card__price-value">
                    {c.observed_price != null
                      ? formatUsd(c.observed_price)
                      : "No current price observed"}
                  </span>
                </div>
                {primary.length > 0 ? (
                  <ul className="n-candidate-card__ids">
                    {primary.map((chip) => (
                      <li key={chip}>{chip}</li>
                    ))}
                  </ul>
                ) : null}
                {extra.length > 0 ? (
                  <details className="n-disclosure n-candidate-card__more">
                    <summary className="n-disclosure__summary">More details</summary>
                    <div className="n-disclosure__body muted">
                      <ul className="n-candidate-card__ids">
                        {extra.map((chip) => (
                          <li key={chip}>{chip}</li>
                        ))}
                      </ul>
                    </div>
                  </details>
                ) : null}
                <p className="n-candidate-card__source">{c.source_note}</p>
              </div>
            </label>
          );
        })}
      </div>

      {weakSelected && selected ? (
        <div
          className="n-weak-candidate-panel"
          data-testid="weak-candidate-warning"
          role="status"
        >
          <h3 className="n-weak-candidate-panel__heading">We need one more detail</h3>
          <p>
            This looks like a possible match, but Nobu needs the Target link, TCIN,
            UPC or model before monitoring can begin.
          </p>
          <a className="n-btn n-btn--secondary" href={editHref} data-testid="add-product-details">
            Add product details
          </a>
        </div>
      ) : null}

      <div className="n-selection-sticky" data-testid="selection-sticky">
        <div className="n-selection-sticky__inner">
          <Button
            type="button"
            block
            data-testid="continue-selected"
            disabled={!strongSelected}
            disabledReason="Select a product to continue"
            onClick={() => {
              if (strongSelected) setStage("confirm");
            }}
          >
            Continue with selected product
          </Button>
          <a
            className="n-btn n-btn--secondary n-btn--block"
            href={editHref}
            data-testid="none-of-these"
          >
            None of these — edit my details
          </a>
        </div>
      </div>
    </div>
  );
}

export function NoResultsState({ editHref }: { editHref: string }) {
  return (
    <div className="n-empty-state-panel" data-testid="no-candidates">
      <h2 className="n-selection-heading" data-testid="no-results-heading">
        We could not identify the product yet
      </h2>
      <p className="n-selection-support">
        Try adding the product name, Target link, TCIN, model or UPC.
      </p>
      <div className="n-selection-actions">
        <a className="n-btn n-btn--block" href={editHref} data-testid="edit-product-details">
          Edit product details
        </a>
        <a
          className="n-btn n-btn--secondary n-btn--block"
          href={editHref}
          data-testid="try-again"
        >
          Try again
        </a>
      </div>
    </div>
  );
}
