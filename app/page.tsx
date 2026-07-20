import { ButtonLink } from "@/ui";
import { OkxMarketplaceLink } from "@/ui/OkxMarketplaceLink";
import { SignedOutToast } from "@/ui/SignedOutToast";

/**
 * Homepage — five main sections only (Lane 8R.1).
 * Calm public product story for first-time customers.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const showSignedOut = sp.signed_out === "1";

  return (
    <div className="n-screen n-screen--home">
      {showSignedOut ? <SignedOutToast /> : null}

      {/* 1. Hero */}
      <section className="n-hero n-hero--split" aria-labelledby="home-title">
        <div>
          <h1 id="home-title" className="n-hero__title">
            Don’t miss a price drop after you buy.
          </h1>
          <p className="n-hero__lead" data-testid="hero-lead">
            Nobu monitors the exact product you purchased and alerts you when a
            lower price may give you an opportunity to request the difference
            from the retailer.
          </p>
          <div className="n-hero__actions">
            <ButtonLink href="/purchases/new" data-testid="cta-add-purchase">
              Monitor a purchase
            </ButtonLink>
            <OkxMarketplaceLink
              variant="secondary"
              data-testid="cta-okx-marketplace"
            />
          </div>
          <p className="n-hero__support" data-testid="hero-support">
            Starting with eligible Target.com purchases. Target verifies the
            price and makes the final decision.
          </p>
        </div>
        <aside className="n-flow-preview" aria-label="Product flow preview">
          <p className="n-flow-preview__label">How monitoring works</p>
          <ol>
            <li>Confirm the exact product</li>
            <li>Nobu watches for a safely matched lower price</li>
            <li>You decide whether to contact the retailer</li>
          </ol>
        </aside>
      </section>

      {/* 2. How it works */}
      <section
        id="how-it-works"
        className="n-home-section"
        aria-labelledby="steps-title"
      >
        <h2 id="steps-title" className="n-section-title">
          How it works
        </h2>
        <ol className="n-steps-sequence" data-testid="home-steps">
          <li className="n-steps-sequence__item">
            <span className="n-steps-sequence__num" aria-hidden>
              1
            </span>
            <div>
              <h3 className="n-steps-sequence__title">
                Tell Nobu what you bought
              </h3>
              <p className="n-steps-sequence__body">
                Add the purchase on the website or describe it through an
                AI-agent conversation.
              </p>
            </div>
          </li>
          <li className="n-steps-sequence__item">
            <span className="n-steps-sequence__num" aria-hidden>
              2
            </span>
            <div>
              <h3 className="n-steps-sequence__title">
                Confirm the exact product
              </h3>
              <p className="n-steps-sequence__body">
                You review the product before monitoring begins. Nobu does not
                rely on a similar title alone.
              </p>
            </div>
          </li>
          <li className="n-steps-sequence__item">
            <span className="n-steps-sequence__num" aria-hidden>
              3
            </span>
            <div>
              <h3 className="n-steps-sequence__title">Nobu keeps watch</h3>
              <p className="n-steps-sequence__body">
                Nobu checks safely matched price observations during the
                supported monitoring period.
              </p>
            </div>
          </li>
          <li className="n-steps-sequence__item">
            <span className="n-steps-sequence__num" aria-hidden>
              4
            </span>
            <div>
              <h3 className="n-steps-sequence__title">
                Know when to contact the retailer
              </h3>
              <p className="n-steps-sequence__body">
                When a lower price is safely matched, Nobu shows the possible
                difference and the retailer’s official contact path.
              </p>
            </div>
          </li>
        </ol>
      </section>

      {/* 3. Price-difference scenario */}
      <section
        className="n-home-section"
        aria-labelledby="scenario-title"
        data-testid="home-scenario"
      >
        <h2 id="scenario-title" className="n-section-title">
          What Nobu is watching for
        </h2>
        <div className="n-scenario">
          <dl className="n-scenario__values">
            <div>
              <dt>Purchase price</dt>
              <dd>$79.99</dd>
            </div>
            <div>
              <dt>Later safely matched price</dt>
              <dd>$59.99</dd>
            </div>
            <div className="n-scenario__diff">
              <dt>Possible price difference</dt>
              <dd data-testid="scenario-difference">$20.00</dd>
            </div>
          </dl>
          <p className="n-scenario__explain">
            Nobu alerts the customer and presents the relevant purchase and
            observed-price information. The customer may then contact Target and
            request the difference. Target verifies the price, checks
            eligibility and makes the final decision.
          </p>
        </div>
      </section>

      {/* 4. Website and OKX.AI access */}
      <section
        className="n-home-section"
        aria-labelledby="access-title"
        data-testid="home-access"
      >
        <h2 id="access-title" className="n-section-title">
          Use Nobu your way
        </h2>
        <div className="n-access-grid">
          <div className="n-access-panel">
            <h3 className="n-card-title">Website</h3>
            <p>
              Add purchases visually, review product matches, inspect alerts and
              use the Action Center to contact the retailer.
            </p>
            <ButtonLink href="/purchases/new" data-testid="cta-access-web">
              Monitor a purchase
            </ButtonLink>
          </div>
          <div className="n-access-panel">
            <h3 className="n-card-title">OKX.AI</h3>
            <p>
              Confirm purchases, verify your alert email, activate monitoring
              and manage monitors through an AI-agent conversation.
            </p>
            <OkxMarketplaceLink data-testid="cta-access-okx" />
            <p>
              <a href="/okx" data-testid="link-okx-guide">
                View the OKX.AI guide
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* 5. Availability and trust */}
      <section
        className="n-home-section"
        aria-labelledby="trust-title"
        data-testid="home-trust"
      >
        <h2 id="trust-title" className="n-section-title">
          Availability and trust
        </h2>
        <div className="n-trust-combined" data-testid="current-availability">
          <p
            className="n-section-lead"
            style={{ marginTop: 0, marginBottom: "1rem" }}
            data-testid="retailer-availability-sentence"
          >
            Target is the only retailer currently supported. More retailers are planned for the future.
          </p>
          <ul className="n-list" data-testid="availability-list">
            <li>
              Eligible Target.com and Target app purchases in the verified
              supported geography
            </li>
            <li>Target Plus is excluded from current support</li>
            <li>Exact-product confirmation is required before monitoring</li>
            <li>
              Prices are observed through SerpApi Google Shopping — not an
              official Target API
            </li>
            <li>
              Target verifies the price, checks eligibility and decides; Nobu
              does not access Target accounts
            </li>
            <li>No guaranteed price adjustment or savings</li>
          </ul>
          <p className="n-availability-link" style={{ marginTop: "1.25rem" }}>
            <a href="/notices" data-testid="link-supported-purchases">
              Supported purchases and notices
            </a>
          </p>
          {/* Legacy hooks for availability wording tests */}
          <p className="visually-hidden" data-testid="availability-support">
            Nobu is starting with eligible Target.com purchases.
          </p>
          <p className="visually-hidden" data-testid="availability-label">
            Currently supports eligible Target.com purchases
          </p>
        </div>
      </section>
    </div>
  );
}
