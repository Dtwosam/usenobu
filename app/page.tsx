export default function HomePage() {
  return (
    <div>
      <h1>Nobu</h1>
      <p>
        Add a recent eligible <strong>Target.com</strong> purchase once. Nobu
        watches for a lower <strong>observed Target price</strong> during Target&apos;s
        14-day adjustment window and alerts you when you may be able to request the
        difference.
      </p>

      <div className="card">
        <h2>What Nobu does</h2>
        <ul className="notices">
          <li>Monitors third-party shopping-search observations (SerpApi Google Shopping).</li>
          <li>Requires you to confirm the exact Target product before monitoring.</li>
          <li>Shows potential recovery, days remaining, and official Target next steps.</li>
        </ul>
        <h2>What Nobu does not do</h2>
        <ul className="notices">
          <li>Does <strong>not</strong> guarantee a refund.</li>
          <li>Does <strong>not</strong> log into Target or submit claims.</li>
          <li>Does <strong>not</strong> collect cards, bank details, passwords, or 2FA.</li>
          <li>Does <strong>not</strong> call SerpApi data an official Target API price.</li>
        </ul>
        <p className="muted">
          Target verifies the lower price and makes the final decision.
        </p>
        <a className="btn" href="/purchases/new" data-testid="cta-add-purchase">
          Add a Target purchase
        </a>
      </div>

      <div className="banner-fixture" data-testid="home-fixture-notice">
        Demo mode uses <strong>clearly labelled fixture data</strong> for candidate
        discovery and price checks unless a live provider path is wired later. Fixtures
        are never live SerpApi results.
      </div>
    </div>
  );
}
