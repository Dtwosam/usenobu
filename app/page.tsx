/**
 * Home remains product-light in 7.5B1 (shell + tokens only).
 * Full home redesign is Lane 7.5B2. Keep E2E test ids stable.
 */
export default function HomePage() {
  return (
    <div>
      <h1>Nobu</h1>
      <p>
        Track a recent eligible <strong>Target.com</strong> purchase once. Nobu
        watches for a lower observed Target price during Target&apos;s 14-day
        adjustment window and alerts you when you may be able to request the
        difference.
      </p>

      <div className="card">
        <h2>What Nobu does</h2>
        <ul className="notices">
          <li>Watches third-party shopping-search prices for your confirmed product.</li>
          <li>Asks you to confirm the exact Target product before monitoring.</li>
          <li>Shows possible savings, days left, and how to contact Target.</li>
        </ul>
        <h2>What Nobu does not do</h2>
        <ul className="notices">
          <li>Does <strong>not</strong> guarantee a refund.</li>
          <li>Does <strong>not</strong> log into Target or submit claims.</li>
          <li>Does <strong>not</strong> collect cards, bank details, passwords, or 2FA.</li>
          <li>Does <strong>not</strong> treat observed prices as an official Target API.</li>
        </ul>
        <p className="muted">
          Target verifies the lower price and makes the final decision.
        </p>
        <a className="btn" href="/purchases/new" data-testid="cta-add-purchase">
          Track a purchase
        </a>
      </div>

      <div className="banner-fixture" data-testid="home-fixture-notice">
        Demo mode uses <strong>clearly labelled fixture data</strong> for candidate
        discovery and price checks unless a live provider path is wired later. Fixtures
        are never live shopping results.
      </div>
    </div>
  );
}
