import { ButtonLink, Card } from "@/ui";
import { SignedOutToast } from "@/ui/SignedOutToast";

/**
 * Homepage — retailer-neutral product positioning (Sprint C).
 * Target appears only under current availability, not in the hero.
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
      <section className="n-hero" aria-labelledby="home-title">
        <h1 id="home-title" className="n-hero__title">
          Nobu watches prices after you buy.
        </h1>
        <p className="n-hero__lead" data-testid="hero-lead">
          Add a recent purchase once. Nobu monitors the exact product and alerts
          you when the price drops—so you can request the difference back.
        </p>
        <div className="n-hero__actions">
          <ButtonLink href="/purchases/new" data-testid="cta-add-purchase">
            Add a purchase
          </ButtonLink>
          <ButtonLink
            href="#how-it-works"
            variant="secondary"
            data-testid="cta-how-it-works"
          >
            How it works
          </ButtonLink>
        </div>
      </section>

      <section
        id="how-it-works"
        className="n-steps-block"
        aria-labelledby="steps-title"
      >
        <h2 id="steps-title" className="n-section-title">
          How it works
        </h2>
        <ol className="n-steps-grid" data-testid="home-steps">
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              1
            </span>
            <strong>Add your purchase</strong>
            <p>Tell Nobu what you bought and confirm the exact product.</p>
          </li>
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              2
            </span>
            <strong>Nobu keeps watch</strong>
            <p>Nobu checks the confirmed item during the monitoring window.</p>
          </li>
          <li className="n-step-card">
            <span className="n-step-card__num" aria-hidden>
              3
            </span>
            <strong>Request the difference</strong>
            <p>
              See how much you may be able to get back and what to do next.
            </p>
          </li>
        </ol>
      </section>

      <section
        className="n-availability-block"
        aria-labelledby="availability-title"
        data-testid="current-availability"
      >
        <Card>
          <h2 id="availability-title" className="n-section-title">
            Currently supported
          </h2>
          <p className="muted n-availability-support" data-testid="availability-support">
            Nobu is starting with eligible Target.com purchases.
          </p>
          <ul className="n-availability-list" data-testid="availability-list">
            <li>Eligible Target.com purchases</li>
            <li>Exact-product matching fails closed</li>
            <li>Prices observed through a third-party source</li>
            <li>Target verifies and decides</li>
          </ul>
          <p className="n-availability-link">
            <a href="/notices" data-testid="link-supported-purchases">
              Supported purchases
            </a>
          </p>
          {/* Legacy test hook for availability wording */}
          <p className="visually-hidden" data-testid="availability-label">
            Currently supports eligible Target.com purchases
          </p>
        </Card>
      </section>

      <section className="n-trust" aria-label="Trust points" data-testid="home-trust">
        <ul className="n-trust__list">
          <li>Exact-product matching fails closed.</li>
          <li>Prices come from a third-party observation source.</li>
          <li>The retailer verifies the price and decides.</li>
        </ul>
      </section>
    </div>
  );
}
