import { OkxMarketplaceLink } from "./OkxMarketplaceLink.js";

export function Footer() {
  return (
    <footer className="n-footer" data-testid="app-footer">
      <div className="n-footer__inner n-footer__inner--grid">
        <div className="n-footer__col">
          <div className="n-footer__brand">Nobu</div>
          <p className="n-footer__note" data-testid="footer-boundary">
            Nobu identifies possible price differences. The retailer verifies
            eligibility and makes the final decision.
          </p>
        </div>

        <nav className="n-footer__col" aria-label="Product">
          <h2 className="n-footer__heading">Product</h2>
          <a href="/purchases/new">Monitor a purchase</a>
          <a href="/dashboard">My purchases</a>
          <a href="/notices">Supported purchases</a>
        </nav>

        <nav className="n-footer__col" aria-label="Use Nobu">
          <h2 className="n-footer__heading">Use Nobu</h2>
          <OkxMarketplaceLink textLink data-testid="footer-okx-cta" />
          <a href="/okx">OKX.AI guide</a>
          <a href="/okx#faq">FAQ</a>
        </nav>

        <nav className="n-footer__col" aria-label="Trust">
          <h2 className="n-footer__heading">Trust</h2>
          <a href="/notices#privacy">Privacy</a>
          <a href="/notices">Notices</a>
          <a href="/notices#price-source">Price source</a>
        </nav>
      </div>
    </footer>
  );
}
