import { submitPurchaseAction } from "@/web/actions";
import { purchaseFormError } from "@/web/error-copy";
import {
  Button,
  Card,
  DemoDataBanner,
  Field,
  FormError,
  Input,
  PageHeader,
  Select,
  Stepper,
} from "@/ui";

function val(
  sp: Record<string, string | undefined>,
  key: string,
  fallback = "",
): string {
  return sp[key] ?? fallback;
}

export default async function NewPurchasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const errorCode = sp.error;
  const userError = errorCode
    ? purchaseFormError(errorCode, sp.status)
    : null;
  const focusRegion = errorCode === "unsupported_or_ineligible";

  const defaults = {
    url: val(
      sp,
      "target_product_url",
      "https://www.target.com/p/example-widget/-/A-87654321",
    ),
    price: val(sp, "purchase_price", "24.99"),
    date: val(sp, "purchase_date", "2026-07-05"),
    region: val(sp, "region", "TX"),
    tcin: val(sp, "target_item_id", "87654321"),
    model: val(sp, "model_number", "WDG-100"),
    title: val(sp, "product_title", "Example Widget Blue"),
    upc: val(sp, "upc_or_gtin", ""),
    scenario: val(sp, "fixture_scenario", "exact_match"),
  };

  return (
    <div className="n-screen n-screen--form">
      <PageHeader
        title="Add your Target purchase"
        description="Enter the details from a recent online purchase. Nobu will use them to look for the exact Target product."
      />

      <Stepper
        steps={[
          { id: "p", label: "Purchase", state: "current" },
          { id: "r", label: "Product", state: "todo" },
          { id: "w", label: "Watch", state: "todo" },
        ]}
      />

      <DemoDataBanner data-testid="fixture-banner">
        <p>
          <strong>Demo data</strong>
          <br />
          This screen uses test fixtures, not a live current Target price.
          <span className="visually-hidden"> demo fixtures</span>
        </p>
      </DemoDataBanner>

      {userError ? (
        <FormError data-testid="purchase-error" title={userError.heading}>
          <p>{userError.body}</p>
          <p>
            <strong>Next:</strong> {userError.nextAction}
          </p>
          <p className="visually-hidden" data-testid="purchase-error-code">
            {userError.code}
          </p>
        </FormError>
      ) : null}

      <div className="n-form-layout">
        <form
          className="n-card n-form-card"
          action={submitPurchaseAction}
          data-testid="purchase-form"
          noValidate={false}
        >
          <Field
            id="target_product_url"
            label="Target product URL"
            hint="Example: https://www.target.com/p/.../-/A-12345678"
            required
          >
            <Input
              id="target_product_url"
              name="target_product_url"
              required
              data-testid="input-url"
              placeholder="https://www.target.com/p/.../-/A-12345678"
              defaultValue={defaults.url}
              autoComplete="off"
            />
          </Field>

          <div className="grid-2">
            <Field
              id="purchase_price"
              label="Price paid (USD)"
              hint="What you paid for this item"
              required
            >
              <Input
                id="purchase_price"
                name="purchase_price"
                type="number"
                step="0.01"
                min="0.01"
                required
                data-testid="input-price"
                defaultValue={defaults.price}
              />
            </Field>
            <Field
              id="purchase_date"
              label="Purchase date"
              hint="Date on your order or receipt"
              required
            >
              <Input
                id="purchase_date"
                name="purchase_date"
                type="date"
                required
                data-testid="input-date"
                defaultValue={defaults.date}
              />
            </Field>
          </div>

          <div className="grid-2">
            <Field
              id="region"
              label="U.S. state"
              hint="Two-letter code (e.g. TX). Alaska and Hawaii are unsupported."
              error={
                focusRegion
                  ? "Alaska and Hawaii aren’t supported for this MVP."
                  : undefined
              }
            >
              <Input
                id="region"
                name="region"
                maxLength={2}
                placeholder="TX"
                data-testid="input-region"
                defaultValue={defaults.region}
                autoFocus={focusRegion}
                aria-invalid={focusRegion || undefined}
              />
            </Field>
            <Field
              id="purchase_channel_display"
              label="Purchase channel"
              hint="MVP supports Target online only"
            >
              <Input
                id="purchase_channel_display"
                value="Target.com / Target app (online)"
                disabled
                readOnly
                aria-readonly="true"
              />
              <input type="hidden" name="purchase_channel" value="target_online" />
            </Field>
          </div>

          <div className="grid-2">
            <Field
              id="target_item_id"
              label="TCIN (optional)"
              hint="Target item number when you have it"
            >
              <Input
                id="target_item_id"
                name="target_item_id"
                data-testid="input-tcin"
                defaultValue={defaults.tcin}
              />
            </Field>
            <Field
              id="model_number"
              label="Model number (optional)"
              hint="Helps confirm the exact product"
            >
              <Input
                id="model_number"
                name="model_number"
                data-testid="input-model"
                defaultValue={defaults.model}
              />
            </Field>
          </div>

          <div className="grid-2">
            <Field
              id="upc_or_gtin"
              label="UPC or GTIN (optional)"
              hint="Barcode number when available"
            >
              <Input
                id="upc_or_gtin"
                name="upc_or_gtin"
                data-testid="input-upc"
                defaultValue={defaults.upc}
              />
            </Field>
            <Field
              id="product_title"
              label="Product title (optional)"
              hint="Name from your order"
            >
              <Input
                id="product_title"
                name="product_title"
                data-testid="input-title"
                defaultValue={defaults.title}
              />
            </Field>
          </div>

          <details className="n-disclosure n-demo-scenario" open>
            <summary className="n-disclosure__summary">
              <span>Demo options (for testing only)</span>
            </summary>
            <div className="n-disclosure__body">
              <Field
                id="fixture_scenario"
                label="Demo scenario"
                hint="Chooses sample candidates only — not live shopping data"
              >
                <Select
                  id="fixture_scenario"
                  name="fixture_scenario"
                  data-testid="input-scenario"
                  defaultValue={defaults.scenario}
                >
                  <option value="exact_match">Exact Target match (fixture)</option>
                  <option value="ambiguous">Ambiguous multi-Target (fixture)</option>
                  <option value="no_price">No Target price (fixture)</option>
                </Select>
              </Field>
            </div>
          </details>

          <p className="muted n-form-note">
            Currency is USD. Nobu never asks for passwords, cards, bank details, or
            2FA codes.
          </p>

          <Button type="submit" block data-testid="submit-purchase">
            Find my product
          </Button>
        </form>

        <aside className="n-support-panel" aria-label="Supported purchases">
          <Card subtle>
            <h2 className="n-card-title">Supported purchases</h2>
            <ul className="n-list">
              <li>Target.com or Target app</li>
              <li>Sold by Target</li>
              <li>Within the supported window</li>
              <li>No Target Plus</li>
              <li>Alaska and Hawaii are unsupported</li>
            </ul>
            <p className="muted">
              <a href="/notices">See how Nobu works</a>
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
