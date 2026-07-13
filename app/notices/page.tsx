import { DEFAULT_POLICY_DISCLAIMER } from "@/policy/target-us-policy";

export default function NoticesPage() {
  return (
    <div>
      <h1>Supported cases, provenance & privacy</h1>

      <div className="card" data-testid="supported-case-notice">
        <h2>Supported cases (MVP)</h2>
        <ul className="notices">
          <li>Target.com / Target app online purchases only</li>
          <li>Item sold by Target (not Target Plus)</li>
          <li>U.S. locations excluding Alaska and Hawaii</li>
          <li>Within 14 days of purchase</li>
          <li>Identical item with strong product identity</li>
        </ul>
      </div>

      <div className="card" data-testid="provenance-notice">
        <h2>Price provenance</h2>
        <p>
          AfterBuy uses <strong>SerpApi Google Shopping</strong> as a{" "}
          <strong>third-party search observation</strong> source. Observed prices are{" "}
          <strong>not</strong> official Target API prices. Matching is fail-closed.
        </p>
        <p className="muted">{DEFAULT_POLICY_DISCLAIMER}</p>
      </div>

      <div className="card" data-testid="privacy-notice">
        <h2>Privacy & security</h2>
        <ul className="notices">
          <li>We collect only purchase URL, price, date, location/channel, and optional product identifiers.</li>
          <li>No Target passwords, payment cards, bank details, government IDs, or 2FA codes.</li>
          <li>No retailer login and no automated claim submission.</li>
          <li>Do not enter secrets or full card numbers in any field.</li>
        </ul>
      </div>

      <div className="card" data-testid="target-action-notice">
        <h2>Official Target next steps</h2>
        <p>
          Keep your original receipt, digital receipt, or packing slip. Contact Target
          online chat or Guest Services. Target team members verify the current price.
          Screenshots are not accepted as final proof by Target.
        </p>
        <p>
          Guest Services phone (from Target policy fixture):{" "}
          <strong>1-800-591-3869</strong>
        </p>
      </div>
    </div>
  );
}
