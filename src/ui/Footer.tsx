export function Footer() {
  return (
    <footer className="n-footer" data-testid="app-footer">
      <div className="n-footer__inner">
        <div>
          <div className="n-footer__brand">Nobu</div>
          <p className="n-footer__note">
            Nobu is a post-purchase price-monitoring platform. The current live
            integration supports eligible Target.com purchases. Third-party price
            observations are not official Target API prices. Target verifies the
            price and decides any adjustment. Nobu does not guarantee a refund, log
            into Target, or submit claims.
          </p>
        </div>
        <nav className="n-footer__links" aria-label="Footer">
          <a href="/purchases/new">Track a purchase</a>
          <a href="/dashboard">My purchases</a>
          <a href="/notices">Notices &amp; privacy</a>
        </nav>
      </div>
    </footer>
  );
}
