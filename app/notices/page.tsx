import { Card, Disclosure, PageHeader } from "@/ui";
import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";

export default function NoticesPage() {
  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        title="How Nobu works"
        description="Short answers about supported purchases, price data, privacy, and Target’s final decision."
      />

      <div className="n-stack">
        <Card data-testid="supported-case-notice">
          <h2 className="n-card-title">1. Supported purchases</h2>
          <ul className="n-list">
            <li>Target.com or Target app online purchases</li>
            <li>Sold by Target — not Target Plus</li>
            <li>U.S. locations excluding Alaska and Hawaii</li>
            <li>Within Target’s usual 14-day adjustment window</li>
            <li>Exact product confirmed before watching</li>
          </ul>
          <Disclosure title="More detail">
            <p>
              Nobu does not support store-only purchases outside the online channel
              lock, Target Plus marketplace offers, or purchases outside the supported
              geography. Matching is fail-closed when identity is weak.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="provenance-notice">
          <h2 className="n-card-title">2. Price data</h2>
          <p>
            Nobu uses third-party SerpApi shopping observations. This is not an
            official Target API.
          </p>
          <p className="muted">{DEFAULT_POLICY_DISCLAIMER}</p>
          <Disclosure title="What “observed price” means">
            <p>
              Observed prices come from third-party shopping search results filtered
              toward Target. Target team members must still verify the current price
              before any adjustment.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="privacy-notice">
          <h2 className="n-card-title">3. Privacy</h2>
          <ul className="n-list">
            <li>
              Nobu does not collect card, bank, password or 2FA information.
            </li>
            <li>No Target passwords or retailer login.</li>
            <li>Only purchase details needed to find and watch a product.</li>
          </ul>
          <Disclosure title="What we store">
            <p>
              Typical fields: product link, price paid, purchase date, location and
              channel, and optional model / TCIN / UPC. Never enter secrets or full
              card numbers in any field.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="target-action-notice">
          <h2 className="n-card-title">4. Target’s final decision</h2>
          <p>
            Nobu does not log into Target or submit requests. Target verifies prices
            and makes the final adjustment decision.
          </p>
          <Disclosure title="If you contact Target">
            <p>
              Keep your receipt or packing slip. Contact Target online chat or Guest
              Services (1-800-591-3869). Screenshots are not accepted by Target as
              final proof.
            </p>
          </Disclosure>
        </Card>
      </div>
    </div>
  );
}
