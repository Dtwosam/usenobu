import { submitPurchaseAction } from "@/web/actions";

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const error = sp.error;
  const status = sp.status;

  return (
    <div>
      <h1>Add a Target.com purchase</h1>
      <p className="muted">
        Manual entry only. Target online purchases in supported U.S. locations.
      </p>

      {error ? (
        <div className="banner-warn" data-testid="purchase-error">
          Could not start monitoring: <strong>{error}</strong>
          {status ? ` (${status})` : ""}. Check supported cases and try again.
        </div>
      ) : null}

      <div className="banner-fixture" data-testid="fixture-banner">
        Candidate discovery on this form uses <strong>demo fixtures</strong> (not live
        SerpApi). Choose a fixture scenario below for proof paths.
      </div>

      <form className="card" action={submitPurchaseAction} data-testid="purchase-form">
        <label htmlFor="target_product_url">Target product URL</label>
        <input
          id="target_product_url"
          name="target_product_url"
          required
          data-testid="input-url"
          placeholder="https://www.target.com/p/.../-/A-12345678"
          defaultValue="https://www.target.com/p/example-widget/-/A-87654321"
        />

        <div className="grid-2">
          <div>
            <label htmlFor="purchase_price">Purchase price (USD)</label>
            <input
              id="purchase_price"
              name="purchase_price"
              type="number"
              step="0.01"
              min="0.01"
              required
              data-testid="input-price"
              defaultValue="24.99"
            />
          </div>
          <div>
            <label htmlFor="purchase_date">Purchase date</label>
            <input
              id="purchase_date"
              name="purchase_date"
              type="date"
              required
              data-testid="input-date"
              defaultValue="2026-07-05"
            />
          </div>
        </div>

        <div className="grid-2">
          <div>
            <label htmlFor="region">U.S. state (optional)</label>
            <input
              id="region"
              name="region"
              maxLength={2}
              placeholder="TX"
              data-testid="input-region"
              defaultValue="TX"
            />
          </div>
          <div>
            <label htmlFor="target_item_id">TCIN (optional)</label>
            <input
              id="target_item_id"
              name="target_item_id"
              data-testid="input-tcin"
              defaultValue="87654321"
            />
          </div>
        </div>

        <div className="grid-2">
          <div>
            <label htmlFor="model_number">Model number (optional)</label>
            <input
              id="model_number"
              name="model_number"
              data-testid="input-model"
              defaultValue="WDG-100"
            />
          </div>
          <div>
            <label htmlFor="product_title">Product title (optional)</label>
            <input
              id="product_title"
              name="product_title"
              data-testid="input-title"
              defaultValue="Example Widget Blue"
            />
          </div>
        </div>

        <label htmlFor="fixture_scenario">Demo fixture scenario</label>
        <select
          id="fixture_scenario"
          name="fixture_scenario"
          data-testid="input-scenario"
          defaultValue="exact_match"
        >
          <option value="exact_match">Exact Target match (fixture)</option>
          <option value="ambiguous">Ambiguous multi-Target (fixture)</option>
          <option value="no_price">No Target price / no candidates (fixture)</option>
        </select>

        <p className="muted">
          Channel is locked to <code>target_online</code>. Currency locked to USD.
          No password, card, or login fields exist on this form.
        </p>

        <button type="submit" data-testid="submit-purchase">
          Continue to candidate review
        </button>
      </form>
    </div>
  );
}
