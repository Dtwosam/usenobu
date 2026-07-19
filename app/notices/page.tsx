import { Card, Disclosure, InlineNotice, PageHeader } from "@/ui";
import { DEFAULT_POLICY_DISCLAIMER, TARGET_US_POLICY } from "@/policy/target-us-policy";
import { getMemoryPolicyRuntime } from "@/policy/operations/memory-store";

export default function NoticesPage() {
  const policyRuntime = getMemoryPolicyRuntime(new Date().toISOString());

  return (
    <div className="n-screen n-screen--reading">
      <PageHeader
        title="How Nobu works"
        description="Short answers about supported purchases, price data, privacy, and who makes the final decision."
      />

      <div className="n-stack">
        {policyRuntime.warning && (
          <InlineNotice tone="warning" data-testid="policy-review-warning">
            {policyRuntime.warning} Policy version {TARGET_US_POLICY.policy_version}; last
            checked {policyRuntime.record.source_last_checked_at}.
          </InlineNotice>
        )}

        <Card data-testid="platform-notice">
          <h2 className="n-card-title">Platform scope</h2>
          <p data-testid="platform-positioning">
            Nobu is designed to support retailer-specific monitoring integrations. The
            current live version supports eligible Target.com and Target app purchases
            only.
          </p>
        </Card>

        <Card data-testid="supported-case-notice">
          <h2 className="n-card-title">1. Supported purchases</h2>
          <ul className="n-list">
            <li>First live retailer: Target</li>
            <li>Target.com or Target app online purchases</li>
            <li>Sold by Target — not Target Plus</li>
            <li>U.S. locations excluding Alaska and Hawaii</li>
            <li>Within Target’s usual 14-day adjustment window</li>
            <li>
              Exact product details required: Target URL, TCIN, and a model number
              or UPC/GTIN
            </li>
            <li>Exact product confirmed before watching</li>
          </ul>
          <Disclosure title="More detail">
            <p>
              Other retailers remain unsupported until separately integrated and
              governed. Target rules apply only to Target purchases. Matching is
              fail-closed when identity is weak. A valid Target URL and TCIN are
              required, plus at least one additional strong identifier such as model
              or UPC/GTIN, unless deterministic discovery already provides equivalent
              verified identity evidence.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="provenance-notice">
          <h2 className="n-card-title">2. Price data</h2>
          <p>
            For Target purchases, Nobu uses third-party SerpApi shopping observations.
            This is not an official Target API.
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
              channel, TCIN, and a model number or UPC/GTIN. Never enter secrets or full
              card numbers in any field.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="target-action-notice">
          <h2 className="n-card-title">4. Retailer’s final decision</h2>
          <p>
            Nobu guides you through Target’s official request process but never
            submits the request. Nobu does not log into retailer accounts. For Target
            purchases, Target verifies prices and makes the final adjustment decision.
          </p>
          <Disclosure title="If you contact Target">
            <p>
              Keep your receipt or packing slip. Use Target’s official Contact Us
              route (help/contact-us) or Guest Services (1-800-591-3869). Screenshots
              are not accepted by Target as final proof.
            </p>
          </Disclosure>
        </Card>
      </div>
    </div>
  );
}
