"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { submitPurchaseAction } from "@/web/actions";
import { fillDetailsWithAiAction } from "@/web/ai-actions";
import {
  evaluateExactIdentity,
  EXACT_IDENTITY_MISSING_MODEL_OR_UPC,
  EXACT_IDENTITY_SECTION_HEADING,
  extractTcinFromTargetUrl,
  isLikelyTcin,
} from "@/web/exact-identity";
import {
  Button,
  Card,
  DemoDataBanner,
  Field,
  FormError,
  InlineNotice,
  Input,
  Select,
  Stepper,
} from "@/ui";

export type PurchaseDefaults = {
  url: string;
  price: string;
  date: string;
  region: string;
  tcin: string;
  model: string;
  title: string;
  upc: string;
  scenario: string;
};

type Props = {
  defaults: PurchaseDefaults;
  serverError?: {
    heading: string;
    body: string;
    nextAction: string;
    code: string;
  } | null;
  focusRegion?: boolean;
};

const MANUAL_FORM_ID = "purchase-manual-form";

export function PurchaseIntake({ defaults, serverError, focusRegion }: Props) {
  const [purchaseText, setPurchaseText] = useState("");
  // Collapsed by default; open when returning from validation error
  const [showManual, setShowManual] = useState(
    () => Boolean(serverError || focusRegion),
  );
  const [aiPending, startAi] = useTransition();
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const shouldFocusManual = useRef(false);

  const [url, setUrl] = useState(defaults.url);
  const [price, setPrice] = useState(defaults.price);
  const [date, setDate] = useState(defaults.date);
  const [region, setRegion] = useState(defaults.region);
  const [tcin, setTcin] = useState(defaults.tcin);
  const [model, setModel] = useState(defaults.model);
  const [title, setTitle] = useState(defaults.title);
  const [upc, setUpc] = useState(defaults.upc);
  const [scenario, setScenario] = useState(defaults.scenario);
  /** When true, user typed TCIN manually — do not overwrite from URL. */
  const tcinUserEdited = useRef(Boolean(defaults.tcin));

  const fieldMark = useMemo(() => {
    const m = new Set(missing);
    const u = new Set(uncertain);
    return (name: string) => {
      if (m.has(name)) return "missing";
      if (u.has(name)) return "uncertain";
      return null;
    };
  }, [missing, uncertain]);

  const identity = useMemo(
    () =>
      evaluateExactIdentity({
        target_product_url: url,
        target_item_id: tcin,
        model_number: model,
        upc_or_gtin: upc,
      }),
    [url, tcin, model, upc],
  );

  const canFindProduct =
    identity.ok &&
    Boolean(price.trim()) &&
    Boolean(date.trim());

  /** Auto-extract TCIN from trusted Target URL when TCIN empty / not user-owned. */
  function onUrlChange(next: string) {
    setUrl(next);
    if (tcinUserEdited.current && isLikelyTcin(tcin)) return;
    const extracted = extractTcinFromTargetUrl(next);
    if (extracted) {
      setTcin(extracted);
      tcinUserEdited.current = false;
    }
  }

  useEffect(() => {
    if (showManual && shouldFocusManual.current) {
      shouldFocusManual.current = false;
      const target = document.getElementById(
        focusRegion ? "region" : "target_product_url",
      );
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }
  }, [showManual, focusRegion]);

  function openManual(opts?: { focus?: boolean }) {
    if (opts?.focus !== false) shouldFocusManual.current = true;
    setShowManual(true);
  }

  function toggleManual() {
    if (showManual) {
      setShowManual(false);
      return;
    }
    openManual({ focus: true });
  }

  function onFillWithAi() {
    setAiError(null);
    setAiNotice(null);
    startAi(async () => {
      const result = await fillDetailsWithAiAction(purchaseText);
      if (!result.ok) {
        setAiError(
          result.message ||
            "AI assistance is temporarily unavailable. You can still enter the purchase details manually.",
        );
        openManual({ focus: true });
        return;
      }
      const e = result.data.extracted_purchase;
      // Drop known demo placeholders first so they never ride through AI fill
      setUrl((u) => (/example-widget|A-87654321/i.test(u) ? "" : u));
      setTcin((t) => (t === "87654321" ? "" : t));
      setModel((m) => (m === "WDG-100" ? "" : m));
      setTitle((t) => (/example widget/i.test(t) ? "" : t));
      // Fresh AI extraction overrides stale stored values (never silent demo insert)
      if (e.product_url) {
        setUrl(e.product_url);
        const fromUrl = extractTcinFromTargetUrl(e.product_url);
        if (e.target_item_id && isLikelyTcin(e.target_item_id)) {
          setTcin(e.target_item_id);
          tcinUserEdited.current = true;
        } else if (fromUrl) {
          setTcin(fromUrl);
          tcinUserEdited.current = false;
        }
      } else if (e.target_item_id && isLikelyTcin(e.target_item_id)) {
        setTcin(e.target_item_id);
        tcinUserEdited.current = true;
      }
      if (e.purchase_price != null) setPrice(String(e.purchase_price));
      if (e.purchase_date) setDate(e.purchase_date);
      if (e.region) setRegion(e.region);
      if (e.model_number) setModel(e.model_number);
      if (e.product_description) setTitle(e.product_description);
      if (e.upc_or_gtin) setUpc(e.upc_or_gtin);
      setMissing(result.data.missing_fields);
      setUncertain(result.data.uncertain_fields);
      setReviewed(true);
      openManual({ focus: true });
      setAiNotice(
        "Here’s what I understood. Review these details before Nobu starts looking for your product.",
      );
    });
  }

  function markLabel(base: string, field: string): string {
    const m = fieldMark(field);
    if (m === "missing") return `${base} (needed)`;
    if (m === "uncertain") return `${base} (check this)`;
    return base;
  }

  return (
    <div className="n-form-layout">
      <div className="n-stack">
        <Card data-testid="nl-intake-card">
          <h2 className="n-card-title" id="nl-heading">
            Tell Nobu what you bought
          </h2>
          <p className="muted">
            Describe your purchase in your own words. Nobu will fill in the details
            for you to review.
          </p>
          <label className="n-field__label" htmlFor="purchase_text">
            Purchase description
          </label>
          <textarea
            id="purchase_text"
            className="n-textarea"
            data-testid="input-purchase-text"
            rows={4}
            maxLength={2000}
            value={purchaseText}
            onChange={(e) => setPurchaseText(e.target.value)}
            placeholder="I bought a 100-count bottle of up&up acetaminophen from Target online yesterday for $9.99."
          />
          <p className="n-field__hint">
            Example: I bought a 100-count bottle of up&amp;up acetaminophen from Target
            online yesterday for $9.99.
          </p>
          <div className="n-gallery__row" style={{ marginTop: "var(--space-4)" }}>
            <Button
              type="button"
              data-testid="btn-fill-ai"
              loading={aiPending}
              disabled={!purchaseText.trim() || aiPending}
              disabledReason="Enter a short purchase description first"
              onClick={onFillWithAi}
            >
              Fill details with AI
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="btn-manual-entry"
              aria-expanded={showManual}
              aria-controls={MANUAL_FORM_ID}
              onClick={toggleManual}
            >
              {showManual ? "Hide manual form" : "Enter details manually"}
            </Button>
          </div>
          {aiError ? (
            <div style={{ marginTop: "var(--space-4)" }}>
              <InlineNotice tone="warning" data-testid="ai-unavailable-notice">
                <p>{aiError}</p>
              </InlineNotice>
            </div>
          ) : null}
          {aiNotice ? (
            <div
              style={{ marginTop: "var(--space-4)" }}
              data-testid="ai-confirmation-gate"
            >
              <InlineNotice tone="info">
                <p>
                  <strong>Here’s what I understood</strong>
                </p>
                <p>{aiNotice}</p>
                {(missing.length > 0 || uncertain.length > 0) && (
                  <p className="muted">
                    {missing.length > 0
                      ? `Still needed: ${missing.join(", ")}. `
                      : ""}
                    {uncertain.length > 0
                      ? `Please double-check: ${uncertain.join(", ")}.`
                      : ""}
                  </p>
                )}
              </InlineNotice>
            </div>
          ) : null}
          <p
            className="muted"
            style={{ marginTop: "var(--space-4)", fontSize: "0.9rem" }}
          >
            AI helps Nobu understand purchase information. Deterministic retailer rules
            and exact-product matching control every monitoring decision.
          </p>
        </Card>

        {showManual ? (
          <form
            id={MANUAL_FORM_ID}
            className="n-card n-form-card"
            action={submitPurchaseAction}
            data-testid="purchase-form"
          >
            {reviewed ? (
              <p className="muted" data-testid="review-before-find">
                Review these details before Nobu starts looking for your product.
              </p>
            ) : null}

            <Field
              id="retailer_display"
              label="Retailer"
              hint="Only the live supported retailer is available right now"
            >
              <Input
                id="retailer_display"
                value="Target — currently supported"
                disabled
                readOnly
                aria-readonly="true"
                data-testid="input-retailer"
              />
            </Field>

            <Field
              id="target_product_url"
              label={markLabel("Product URL", "product_url")}
              hint="Example: https://www.target.com/p/.../-/A-12345678"
              required
              error={
                fieldMark("product_url") === "missing"
                  ? "Add the Target product link so Nobu can find the exact item."
                  : identity.errors.target_product_url && url.trim()
                    ? identity.errors.target_product_url
                    : undefined
              }
            >
              <Input
                id="target_product_url"
                name="target_product_url"
                required
                data-testid="input-url"
                placeholder="https://www.target.com/p/.../-/A-12345678"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                autoComplete="off"
                invalid={
                  fieldMark("product_url") === "missing" ||
                  Boolean(identity.errors.target_product_url && url.trim())
                }
              />
            </Field>

            <div className="grid-2">
              <Field
                id="purchase_price"
                label={markLabel("Price paid (USD)", "purchase_price")}
                hint="What you paid for this item"
                required
                error={
                  fieldMark("purchase_price") === "missing"
                    ? "Enter the amount you paid."
                    : undefined
                }
              >
                <Input
                  id="purchase_price"
                  name="purchase_price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  data-testid="input-price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  invalid={fieldMark("purchase_price") === "missing"}
                />
              </Field>
              <Field
                id="purchase_date"
                label={markLabel("Purchase date", "purchase_date")}
                hint="Date on your order or receipt"
                required
                error={
                  fieldMark("purchase_date") === "missing"
                    ? "Enter the purchase date."
                    : fieldMark("purchase_date") === "uncertain"
                      ? "Double-check this date."
                      : undefined
                }
              >
                <Input
                  id="purchase_date"
                  name="purchase_date"
                  type="date"
                  required
                  data-testid="input-date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  invalid={
                    fieldMark("purchase_date") === "missing" ||
                    fieldMark("purchase_date") === "uncertain"
                  }
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
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  autoFocus={focusRegion}
                  aria-invalid={focusRegion || undefined}
                />
              </Field>
              <Field
                id="purchase_channel_display"
                label="Purchase channel"
                hint="Online purchases for the supported retailer"
              >
                <Input
                  id="purchase_channel_display"
                  value="Target.com / Target app (online)"
                  disabled
                  readOnly
                  aria-readonly="true"
                />
                <input
                  type="hidden"
                  name="purchase_channel"
                  value="target_online"
                />
              </Field>
            </div>

            <fieldset
              className="n-exact-identity"
              data-testid="exact-product-details"
            >
              <legend className="n-card-title">
                {EXACT_IDENTITY_SECTION_HEADING}
              </legend>
              <p className="muted">
                Nobu needs a Target link, TCIN, and a model number or UPC so it
                does not watch the wrong item.
              </p>

              <div className="grid-2">
                <Field
                  id="target_item_id"
                  label={markLabel("TCIN", "target_item_id")}
                  hint="Target item number"
                  required
                  error={
                    identity.errors.target_item_id && (url.trim() || tcin.trim())
                      ? identity.errors.target_item_id
                      : undefined
                  }
                >
                  <Input
                    id="target_item_id"
                    name="target_item_id"
                    required
                    data-testid="input-tcin"
                    value={tcin}
                    onChange={(e) => {
                      tcinUserEdited.current = true;
                      setTcin(e.target.value);
                    }}
                    autoComplete="off"
                    invalid={Boolean(
                      identity.errors.target_item_id &&
                        (url.trim() || tcin.trim()),
                    )}
                  />
                </Field>
                <Field
                  id="model_number"
                  label={markLabel("Model number", "model_number")}
                  hint="Add a model number or UPC so Nobu can confirm the exact item."
                >
                  <Input
                    id="model_number"
                    name="model_number"
                    data-testid="input-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <div className="grid-2">
                <Field
                  id="upc_or_gtin"
                  label="UPC or GTIN"
                  hint="Add a model number or UPC so Nobu can confirm the exact item."
                  error={
                    identity.errors.model_or_upc &&
                    (model.trim() || upc.trim() || tcin.trim())
                      ? EXACT_IDENTITY_MISSING_MODEL_OR_UPC
                      : undefined
                  }
                >
                  <Input
                    id="upc_or_gtin"
                    name="upc_or_gtin"
                    data-testid="input-upc"
                    value={upc}
                    onChange={(e) => setUpc(e.target.value)}
                    autoComplete="off"
                    invalid={Boolean(
                      identity.errors.model_or_upc &&
                        (model.trim() || upc.trim() || tcin.trim()),
                    )}
                  />
                </Field>
                <Field
                  id="product_title"
                  label={markLabel("Product title", "product_description")}
                  hint="Name from your order"
                >
                  <Input
                    id="product_title"
                    name="product_title"
                    data-testid="input-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
              </div>

              {identity.errors.model_or_upc &&
              (url.trim() || tcin.trim()) &&
              !identity.has_model_or_upc ? (
                <p
                  className="n-field__error"
                  data-testid="identity-model-or-upc-error"
                  role="alert"
                >
                  {EXACT_IDENTITY_MISSING_MODEL_OR_UPC}
                </p>
              ) : null}
            </fieldset>

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
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
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
              2FA codes. Finding a product never starts monitoring by itself — you still
              confirm the exact item next.
            </p>

            <Button
              type="submit"
              block
              data-testid="submit-purchase"
              disabled={!canFindProduct}
              disabledReason={
                !identity.has_model_or_upc
                  ? EXACT_IDENTITY_MISSING_MODEL_OR_UPC
                  : !identity.has_tcin
                    ? "Add a TCIN or a Target product link that includes it."
                    : !identity.has_target_url
                      ? "Add a valid Target.com product link."
                      : "Enter the price paid and purchase date."
              }
            >
              Find my product
            </Button>
          </form>
        ) : (
          <div
            id={MANUAL_FORM_ID}
            hidden
            data-testid="purchase-form-collapsed"
            aria-hidden="true"
          />
        )}
      </div>

      <aside className="n-support-panel" aria-label="Supported purchases">
        <Card subtle>
          <h2 className="n-card-title">Currently supported</h2>
          <ul className="n-list">
            <li>Retailer: Target (first live integration)</li>
            <li>Target.com or Target app</li>
            <li>Sold by Target — not Target Plus</li>
            <li>Within the monitoring window</li>
            <li>Alaska and Hawaii are unsupported</li>
          </ul>
          <p className="muted" data-testid="unsupported-retailer-note">
            This retailer isn’t supported yet for other stores. Nobu currently supports
            eligible Target.com purchases.{" "}
            <a href="/notices">See how Nobu works</a>
          </p>
        </Card>
      </aside>
    </div>
  );
}

/** Re-export helpers for server page composition */
export function PurchasePageChrome({
  children,
  serverError,
}: {
  children: React.ReactNode;
  serverError?: {
    heading: string;
    body: string;
    nextAction: string;
    code: string;
  } | null;
}) {
  return (
    <div className="n-screen n-screen--form">
      <div className="n-page-header">
        <h1 className="n-page-header__title">Add your purchase</h1>
        <p className="n-page-header__desc">
          Tell Nobu what you bought, or enter the details. You will always review them
          before Nobu looks for your product.
        </p>
      </div>

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

      {serverError ? (
        <FormError data-testid="purchase-error" title={serverError.heading}>
          <p>{serverError.body}</p>
          <p>
            <strong>Next:</strong> {serverError.nextAction}
          </p>
          <p className="visually-hidden" data-testid="purchase-error-code">
            {serverError.code}
          </p>
        </FormError>
      ) : null}

      {children}
    </div>
  );
}
