"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { submitPurchaseAction } from "@/web/actions";
import { fillDetailsWithAiAction } from "@/web/ai-actions";
import {
  extractTcinFromTargetUrl,
  isLikelyTcin,
  provisionalTitleFromTargetUrl,
  provisionalTitleFromTcin,
} from "@/web/exact-identity";
import {
  canSubmitFindProduct,
  isMeaningfulDescription,
} from "@/web/product-clue";
import {
  Button,
  Card,
  DemoDataBanner,
  Field,
  FormError,
  InlineNotice,
  Input,
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
  description: string;
  brand: string;
  color: string;
  size: string;
  quantity: string;
  showFixtureBanner: boolean;
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

function humanMissingField(name: string): string {
  switch (name) {
    case "product_url":
      return "Target product link";
    case "product_url_or_tcin_or_description":
      return "product name, Target link, TCIN, model or UPC";
    case "purchase_price":
      return "price paid";
    case "purchase_date":
      return "purchase date";
    case "product_description":
      return "product title or description";
    case "target_item_id":
      return "TCIN";
    default:
      return name.replace(/_/g, " ");
  }
}

export function PurchaseIntake({ defaults, serverError, focusRegion }: Props) {
  const [purchaseText, setPurchaseText] = useState("");
  const [showManual, setShowManual] = useState(
    () => Boolean(serverError || focusRegion),
  );
  const [aiPending, startAi] = useTransition();
  const [submitting, setSubmitting] = useState(false);
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
  const [title, setTitle] = useState(
    defaults.title || defaults.description || "",
  );
  const [upc, setUpc] = useState(defaults.upc);
  const [brand, setBrand] = useState(defaults.brand);
  const [color, setColor] = useState(defaults.color);
  const [size, setSize] = useState(defaults.size);
  const [quantity, setQuantity] = useState(defaults.quantity);
  const tcinUserEdited = useRef(Boolean(defaults.tcin));
  const titleUserEdited = useRef(
    Boolean(defaults.title || defaults.description),
  );
  const [titleSource, setTitleSource] = useState<
    "user" | "link" | "tcin" | "none"
  >(defaults.title || defaults.description ? "user" : "none");

  const fieldMark = useMemo(() => {
    const m = new Set(missing);
    const u = new Set(uncertain);
    return (name: string) => {
      if (m.has(name)) return "missing";
      if (u.has(name)) return "uncertain";
      return null;
    };
  }, [missing, uncertain]);

  const gate = useMemo(
    () =>
      canSubmitFindProduct({
        purchase_price: price,
        purchase_date: date,
        region,
        clues: {
          product_title: title,
          product_description: title,
          target_product_url: url,
          target_item_id: tcin,
          model_number: model,
          upc_or_gtin: upc,
        },
      }),
    [price, date, region, title, url, tcin, model, upc],
  );

  const canFindProduct = gate.ok && !submitting;

  function applyProvisionalTitleFromUrl(nextUrl: string) {
    if (titleUserEdited.current && isMeaningfulDescription(title)) return;
    const provisional = provisionalTitleFromTargetUrl(nextUrl);
    if (provisional) {
      setTitle(provisional);
      setTitleSource("link");
    }
  }

  function applyProvisionalTitleFromTcin(nextTcin: string) {
    if (titleUserEdited.current && isMeaningfulDescription(title)) return;
    if (url.trim() && provisionalTitleFromTargetUrl(url)) return;
    const provisional = provisionalTitleFromTcin(nextTcin);
    if (provisional) {
      setTitle(provisional);
      setTitleSource("tcin");
    }
  }

  function onUrlChange(next: string) {
    setUrl(next);
    if (!tcinUserEdited.current || !isLikelyTcin(tcin)) {
      const extracted = extractTcinFromTargetUrl(next);
      if (extracted) {
        setTcin(extracted);
        tcinUserEdited.current = false;
      }
    }
    applyProvisionalTitleFromUrl(next);
  }

  function onTcinChange(next: string) {
    tcinUserEdited.current = true;
    setTcin(next);
    if (isLikelyTcin(next)) {
      applyProvisionalTitleFromTcin(next);
    }
  }

  useEffect(() => {
    if (showManual && shouldFocusManual.current) {
      shouldFocusManual.current = false;
      const target = document.getElementById(
        focusRegion ? "region" : "product_title",
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
      setUrl((u) => (/example-widget|A-87654321/i.test(u) ? "" : u));
      setTcin((t) => (t === "87654321" ? "" : t));
      setModel((m) => (m === "WDG-100" ? "" : m));
      setTitle((t) => (/example widget/i.test(t) ? "" : t));
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
        applyProvisionalTitleFromUrl(e.product_url);
      } else if (e.target_item_id && isLikelyTcin(e.target_item_id)) {
        setTcin(e.target_item_id);
        tcinUserEdited.current = true;
        applyProvisionalTitleFromTcin(e.target_item_id);
      }
      if (e.purchase_price != null) setPrice(String(e.purchase_price));
      if (e.purchase_date) setDate(e.purchase_date);
      if (e.region) setRegion(e.region);
      if (e.model_number) setModel(e.model_number);
      if (e.product_description) {
        setTitle(e.product_description);
        titleUserEdited.current = true;
        setTitleSource("user");
      }
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
                      ? `Still needed: ${missing.map(humanMissingField).join(", ")}. `
                      : ""}
                    {uncertain.length > 0
                      ? `Please double-check: ${uncertain.map(humanMissingField).join(", ")}.`
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
            onSubmit={() => setSubmitting(true)}
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

            <fieldset
              className="n-product-details"
              data-testid="product-details-section"
            >
              <legend className="n-card-title">Product details</legend>
              <p className="muted">
                Enter whatever you have. Nobu uses your details to find one match or
                a short list of Target products for you to choose.
              </p>

              <Field
                id="product_title"
                label={markLabel(
                  "Product title or description",
                  "product_description",
                )}
                hint='Example: "Apple AirPods" — or leave blank if you have a Target link or TCIN'
              >
                <Input
                  id="product_title"
                  name="product_title"
                  data-testid="input-title"
                  placeholder="Apple AirPods"
                  value={title}
                  onChange={(e) => {
                    titleUserEdited.current = true;
                    setTitleSource("user");
                    setTitle(e.target.value);
                  }}
                />
                {titleSource === "link" ? (
                  <p className="muted" data-testid="title-link-derived">
                    Title derived from the product link. You can correct it before confirmation.
                  </p>
                ) : null}
                <input type="hidden" name="product_description" value={title} />
              </Field>

              <Field
                id="target_product_url"
                label={markLabel("Target product URL", "product_url")}
                hint="Optional. Example: https://www.target.com/p/.../-/A-12345678"
              >
                <Input
                  id="target_product_url"
                  name="target_product_url"
                  data-testid="input-url"
                  placeholder="https://www.target.com/p/.../-/A-12345678"
                  value={url}
                  onChange={(e) => onUrlChange(e.target.value)}
                  autoComplete="off"
                />
              </Field>

              <div className="grid-2">
                <Field
                  id="target_item_id"
                  label={markLabel("TCIN", "target_item_id")}
                  hint="Optional Target item number (5–12 digits)"
                >
                  <Input
                    id="target_item_id"
                    name="target_item_id"
                    data-testid="input-tcin"
                    value={tcin}
                    onChange={(e) => onTcinChange(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  id="model_number"
                  label={markLabel("Model number", "model_number")}
                  hint="Optional"
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
                <Field id="upc_or_gtin" label="UPC or GTIN" hint="Optional">
                  <Input
                    id="upc_or_gtin"
                    name="upc_or_gtin"
                    data-testid="input-upc"
                    value={upc}
                    onChange={(e) => setUpc(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field id="brand" label="Brand" hint="Optional">
                  <Input
                    id="brand"
                    name="brand"
                    data-testid="input-brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <div className="grid-2">
                <Field id="color" label="Colour" hint="Optional">
                  <Input
                    id="color"
                    name="color"
                    data-testid="input-color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Field id="size" label="Size" hint="Optional">
                  <Input
                    id="size"
                    name="size"
                    data-testid="input-size"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
              </div>

              <Field
                id="quantity"
                label="Quantity or pack count"
                hint="Optional"
              >
                <Input
                  id="quantity"
                  name="quantity"
                  data-testid="input-quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  autoComplete="off"
                />
              </Field>

              <p className="muted" data-testid="identity-progressive-note">
                If several Target products look similar, Nobu will ask you to choose
                the exact one before monitoring starts.
              </p>
            </fieldset>

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

            <p className="muted n-form-note">
              Currency is USD. Nobu never asks for passwords, cards, bank details, or
              2FA codes. Finding a product never starts monitoring by itself — you still
              confirm the exact item next.
            </p>

            {!gate.ok ? (
              <p
                className="n-form-hint-disabled"
                data-testid="find-product-hint"
                id="find-product-hint"
              >
                Add at least one product detail so Nobu can search for it.
              </p>
            ) : null}

            <div aria-live="polite" className="visually-hidden">
              {submitting ? "Finding your product…" : ""}
            </div>

            <Button
              type="submit"
              block
              data-testid="submit-purchase"
              disabled={!canFindProduct}
              loading={submitting}
              loadingLabel="Finding your product…"
              disabledReason={gate.reason || undefined}
              aria-describedby={!gate.ok ? "find-product-hint" : undefined}
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

export function PurchasePageChrome({
  children,
  serverError,
  showFixtureBanner = false,
}: {
  children: React.ReactNode;
  serverError?: {
    heading: string;
    body: string;
    nextAction: string;
    code: string;
  } | null;
  showFixtureBanner?: boolean;
}) {
  return (
    <div className="n-screen n-screen--form">
      <div className="n-page-header">
        <h1 className="n-page-header__title">Monitor a purchase</h1>
        <p className="n-page-header__desc">
          Tell Nobu what you bought. Purchase price, date and exact product
          details help Nobu determine whether it can safely monitor for a
          possible price difference.
        </p>
      </div>

      <aside className="n-help-panel" data-testid="exact-product-help">
        <h2>Why the exact product matters</h2>
        <p>
          A lower price is only useful when it belongs to the same product and
          variant. Nobu fails closed when it cannot verify the match.
        </p>
      </aside>

      <Stepper
        steps={[
          { id: "p", label: "Purchase", state: "current" },
          { id: "r", label: "Product", state: "todo" },
          { id: "w", label: "Watch", state: "todo" },
        ]}
      />

      {showFixtureBanner ? (
        <DemoDataBanner data-testid="fixture-banner">
          <p>
            <strong>Demo data</strong>
            <br />
            This screen uses test fixtures, not a live current Target price.
            <span className="visually-hidden"> demo fixtures</span>
          </p>
        </DemoDataBanner>
      ) : null}

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
