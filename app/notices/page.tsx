import { Card, Disclosure, InlineNotice, PageHeader } from "@/ui";
import { DEFAULT_POLICY_DISCLAIMER, TARGET_US_POLICY } from "@/policy/target-us-policy";
import { tryGetPolicyOperationsStore } from "@/policy/operations/factory";
import { getPolicyRuntimeFromStore } from "@/policy/operations/service";

export default async function NoticesPage() {
  let policyWarning: string | null = null;
  let sourceChecked: string | null = null;
  const storeResult = await tryGetPolicyOperationsStore();
  if (storeResult.ok) {
    try {
      const runtime = await getPolicyRuntimeFromStore(
        storeResult.store,
        new Date().toISOString(),
      );
      policyWarning = runtime.warning;
      sourceChecked = runtime.record.source_last_checked_at;
    } catch {
      policyWarning =
        "Policy operations store is temporarily unavailable. Target remains the final decision-maker.";
    }
  }

  return (
    <div className="n-screen n-screen--reading" data-testid="notices-page">
      <PageHeader
        title="Notices"
        description="Supported purchases, matching, price source, alerts, privacy, and who makes the final decision."
      />

      <div className="n-stack">
        {policyWarning && (
          <InlineNotice tone="warning" data-testid="policy-review-warning">
            {policyWarning} Policy version {TARGET_US_POLICY.policy_version}
            {sourceChecked ? `; last checked ${sourceChecked}` : ""}.
          </InlineNotice>
        )}

        <Card data-testid="supported-case-notice" id="supported-purchases">
          <h2 className="n-card-title">Supported purchases</h2>
          <ul className="n-list">
            <li>Eligible Target.com and Target app online purchases</li>
            <li>Sold by Target — Target Plus excluded</li>
            <li>U.S. locations excluding Alaska and Hawaii (verified policy)</li>
            <li>Within Target’s usual 14-day adjustment window</li>
            <li>Exact product details required before monitoring</li>
          </ul>
          <p data-testid="platform-positioning">
            Nobu is designed to support retailer-specific monitoring. The
            current live version supports eligible Target.com and Target app
            purchases only.
          </p>
        </Card>

        <Card data-testid="exact-match-notice" id="exact-product">
          <h2 className="n-card-title">Exact-product matching</h2>
          <p>
            You confirm the exact product before monitoring begins. Nobu does
            not rely on a similar title alone. When a match is ambiguous, Nobu
            fails closed and does not treat the observation as a lower price.
          </p>
        </Card>

        <Card data-testid="provenance-notice" id="price-source">
          <h2 className="n-card-title">Price source</h2>
          <p>
            For Target purchases, Nobu uses third-party SerpApi Google Shopping
            observations filtered toward Target. This is not an official Target
            API.
          </p>
          <p className="muted">{DEFAULT_POLICY_DISCLAIMER}</p>
          <Disclosure title="What “observed price” means">
            <p>
              Observed prices come from third-party shopping search results.
              Target team members must still verify the current price before any
              adjustment.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="target-action-notice" id="retailer-decision">
          <h2 className="n-card-title">Retailer decision</h2>
          <p>
            Nobu identifies a possible price difference and shows Target’s
            official contact path. Nobu does not contact Target, submit a
            request, recover money, or guarantee a price adjustment. You contact
            Target. Target verifies the price, checks eligibility and makes the
            final decision.
          </p>
        </Card>

        <Card data-testid="email-alerts-notice" id="email-alerts">
          <h2 className="n-card-title">Email alerts</h2>
          <p>
            Email alerts are optional and require a verified account email and
            your consent. You can disable alerts or stop monitoring at any time.
            Alerts notify you of a possible opportunity — they do not mean a
            refund or adjustment is approved.
          </p>
        </Card>

        <Card data-testid="okx-payment-notice" id="okx-payment">
          <h2 className="n-card-title">OKX payment</h2>
          <p data-testid="okx-payment-notice-copy">
            The $0.99 OKX payment activates monitoring for one confirmed and eligible purchase. It does not guarantee a price drop, alert, refund or price adjustment.
          </p>
        </Card>

        <Card data-testid="privacy-notice" id="privacy">
          <h2 className="n-card-title">Privacy</h2>
          <ul className="n-list">
            <li>
              Nobu does not collect card, bank, password or 2FA information.
            </li>
            <li>No Target passwords or retailer account login.</li>
            <li>Only purchase details needed to find and watch a product.</li>
            <li>
              Email used for optional sign-in and consented alerts is private
              and is not shown in logs or public proof.
            </li>
          </ul>
          <Disclosure title="What we store">
            <p>
              Typical fields: product link, price paid, purchase date, location
              and channel, TCIN, and a model number or UPC/GTIN. Never enter
              secrets or full card numbers in any field.
            </p>
          </Disclosure>
        </Card>

        <Card data-testid="stopping-notice" id="stopping-monitoring">
          <h2 className="n-card-title">Stopping monitoring</h2>
          <p>
            You can stop monitoring for a purchase at any time. Nobu will no
            longer run scheduled checks for that purchase. Stopping does not
            submit a retailer request or reverse a monitoring activation
            payment.
          </p>
        </Card>

        <Card data-testid="guest-purchases-notice" id="guest-purchases">
          <h2 className="n-card-title">Guest purchases</h2>
          <ul className="n-list">
            <li>
              As a guest, purchases stay in this browser only (not a full
              account).
            </li>
            <li>
              After you verify email, purchases from this browser can move into
              your Nobu account.
            </li>
            <li>
              Only this browser’s guest session can claim those purchases — not
              another device or user.
            </li>
            <li>Signing out never deletes your account purchase history.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
