import {
  ButtonLink,
  Card,
  DemoDataBanner,
  InlineNotice,
  StatusBadge,
} from "@/ui";

/**
 * Homepage — Lane 7.5B2 consumer redesign.
 * Primary action only: track a purchase. No long policy above the fold.
 */
export default function HomePage() {
  return (
    <div className="n-screen n-screen--home">
      <section className="n-hero" aria-labelledby="home-title">
        <p className="n-page-header__eyebrow">Post-purchase price monitoring</p>
        <h1 id="home-title" className="n-hero__title">
          Bought it? We’ll keep watch.
        </h1>
        <p className="n-hero__lead">
          Add a recent Target purchase. Nobu watches for a lower observed Target
          price during the supported window and lets you know when there may be a
          difference to request.
        </p>
        <div className="n-hero__actions">
          <ButtonLink href="/purchases/new" data-testid="cta-add-purchase">
            Track a Target purchase
          </ButtonLink>
          <ButtonLink href="/notices" variant="secondary" data-testid="cta-how-it-works">
            See how it works
          </ButtonLink>
        </div>
      </section>

      <section className="n-steps-block" aria-labelledby="steps-title">
        <h2 id="steps-title" className="n-section-title">
          Three simple steps
        </h2>
        <ol className="n-steps-grid">
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              1
            </span>
            <strong>Add your purchase</strong>
            <p>Enter details from a recent Target.com order.</p>
          </li>
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              2
            </span>
            <strong>Confirm the exact product</strong>
            <p>Make sure Nobu locks the right item before watching.</p>
          </li>
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              3
            </span>
            <strong>Nobu watches the price</strong>
            <p>We’ll alert you if a lower observed Target price appears.</p>
          </li>
        </ol>
      </section>

      <section className="n-trust" aria-label="Trust points">
        <ul className="n-trust__list">
          <li>Target.com purchases only</li>
          <li>No retailer login required</li>
          <li>Target makes the final decision</li>
        </ul>
      </section>

      <DemoDataBanner data-testid="home-fixture-notice">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current Target price.
        </p>
      </DemoDataBanner>

      <Card className="n-example-card" data-testid="home-example-card">
        <div className="n-example-card__head">
          <StatusBadge label="Example — not live data" tone="warning" />
        </div>
        <h2 className="n-example-card__title">Example result</h2>
        <p className="muted">
          Sample only — not your purchase and not a live Target price.
        </p>
        <div className="n-price-summary">
          <dl>
            <div className="n-price-summary__row">
              <dt>You paid</dt>
              <dd className="n-money">$24.99</dd>
            </div>
            <div className="n-price-summary__row">
              <dt>Observed Target price</dt>
              <dd className="n-money">$19.99</dd>
            </div>
            <div className="n-price-summary__row n-price-summary__diff">
              <dt>Possible difference</dt>
              <dd className="n-money">$5.00</dd>
            </div>
          </dl>
        </div>
        <InlineNotice tone="info">
          <p>
            Target must verify the current price and decides any adjustment. Nobu
            does not guarantee a refund.
          </p>
        </InlineNotice>
      </Card>
    </div>
  );
}
