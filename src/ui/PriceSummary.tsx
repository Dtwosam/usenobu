export type PriceSummaryProps = {
  purchasePriceLabel?: string;
  purchasePrice: string;
  observedPriceLabel?: string;
  observedPrice?: string;
  differenceLabel?: string;
  difference?: string;
  note?: string;
};

export function PriceSummary({
  purchasePriceLabel = "What you paid",
  purchasePrice,
  observedPriceLabel = "Lower price we saw",
  observedPrice,
  differenceLabel = "Possible difference",
  difference,
  note,
}: PriceSummaryProps) {
  return (
    <div className="n-price-summary">
      <dl>
        <div className="n-price-summary__row">
          <dt>{purchasePriceLabel}</dt>
          <dd>{purchasePrice}</dd>
        </div>
        {observedPrice ? (
          <div className="n-price-summary__row">
            <dt>{observedPriceLabel}</dt>
            <dd>{observedPrice}</dd>
          </div>
        ) : null}
        {difference ? (
          <div className="n-price-summary__row n-price-summary__diff">
            <dt>{differenceLabel}</dt>
            <dd>{difference}</dd>
          </div>
        ) : null}
      </dl>
      {note ? (
        <p className="muted" style={{ margin: 0 }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
