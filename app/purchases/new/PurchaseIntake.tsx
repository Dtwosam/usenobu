"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { submitPurchaseAction } from "@/web/actions";
import { fillDetailsWithAiAction } from "@/web/ai-actions";
import {
  evaluateExactIdentity,
  EXACT_IDENTITY_SECTION_HEADING,
  extractTcinFromTargetUrl,
  isLikelyTcin,
  provisionalTitleFromTargetUrl,
  provisionalTitleFromTcin,
} from "@/web/exact-identity";
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

export type ProductEntryMode = "exact" | "find";

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
  entryMode: ProductEntryMode;
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
      return "Target product link (or enter a TCIN)";
    case "product_url_or_tcin_or_description":
      return "Target product link, TCIN, or product description";
    case "product_url_or_tcin":
      return "Target product link or TCIN";
    case "purchase_price":
      return "price paid";
    case "purchase_date":
      return "purchase date";
    case "product_description":
      return "product description";
    case "target_item_id":
      return "TCIN";
    default:
      return name.replace(/_/g, " ");
  }
}

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

  const [entryMode, setEntryMode] = useState<ProductEntryMode>(
    defaults.entryMode || "exact",
  );
  const [url, setUrl] = useState(defaults.url);
  const [price, setPrice] = useState(defaults.price);
  const [date, setDate] = useState(defaults.date);
  const [region, setRegion] = useState(defaults.region);
  const [tcin, setTcin] = useState(defaults.tcin);
  const [model, setModel] = useState(defaults.model);
  const [title, setTitle] = useState(defaults.title);
  const [upc, setUpc] = useState(defaults.upc);
  const [description, setDescription] = useState(
    defaults.description || defaults.title,
  );
  const [brand, setBrand] = useState(defaults.brand);
  const [color, setColor] = useState(defaults.color);
  const [size, setSize] = useState(defaults.size);
  const [quantity, setQuantity] = useState(defaults.quantity);
  /** When true, user typed TCIN manually — do not overwrite from URL. */
  const tcinUserEdited = useRef(Boolean(defaults.tcin));
  /** When true, user edited title — do not overwrite with link-derived provisional. */
  const titleUserEdited = useRef(Boolean(defaults.title));
  const [titleSource, setTitleSource] = useState<
    "user" | "link" | "tcin" | "none"
  >(defaults.title ? "user" : "none");

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

  const canFindExact =
    identity.ok && Boolean(price.trim()) && Boolean(date.trim());

  const canFindUncertain =
    Boolean(description.trim()) &&
    Boolean(price.trim()) &&
    Boolean(date.trim());

  const canFindProduct =
    entryMode === "exact" ? canFindExact : canFindUncertain;

  function applyProvisionalTitleFromUrl(nextUrl: string) {
    if (titleUserEdited.current && title.trim()) return;
    const provisional = provisionalTitleFromTargetUrl(nextUrl);
    if (provisional) {
      setTitle(provisional);
      setTitleSource("link");
    }
  }

  function applyProvisionalTitleFromTcin(nextTcin: string) {
    if (titleUserEdited.current && title.trim()) return;
    if (url.trim() && provisionalTitleFromTargetUrl(url)) return;
    const provisional = provisionalTitleFromTcin(nextTcin);
    if (provisional) {
      setTitle(provisional);
      setTitleSource("tcin");
    }
  }

  /** Auto-extract TCIN from trusted Target URL when TCIN empty / not user-owned. */
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
        focusRegion
          ? "region"
          : entryMode === "find"
            ? "product_description"
            : "target_product_url",
      );
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }
  }, [showManual, focusRegion, entryMode]);

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
        applyProvisionalTitleFromUrl(e.product_url);
        setEntryMode("exact");
      } else if (e.target_item_id && isLikelyTcin(e.target_item_id)) {
        setTcin(e.target_item_id);
        tcinUserEdited.current = true;
        applyProvisionalTitleFromTcin(e.target_item_id);
        setEntryMode("exact");
      } else if (e.product_description) {
        setDescription(e.product_description);
        setTitle(e.product_description);
        titleUserEdited.current = true;
        setTitleSource("user");
        setEntryMode("find");
      }
      if (e.purchase_price != null) setPrice(String(e.purchase_price));
      if (e.purchase_date) setDate(e.purchase_date);
      if (e.region) setRegion(e.region);
      if (e.model_number) setModel(e.model_number);
      if (e.product_description && e.product_url) {
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

  function findDisabledReason(): string {
    if (entryMode === "exact") {
      if (identity.errors.target_item_id && (url.trim() || tcin.trim())) {
        return identity.errors.target_item_id;
      }
      if (identity.errors.target_product_url && url.trim()) {
        return identity.errors.target_product_url;
      }
      if (!identity.ok) {
        return (
          identity.errors.identity ||
          "Add a Target product link or a TCIN. You do not need both."
        );
      }
      if (!price.trim() || !date.trim()) {
        return "Enter the price paid and purchase date.";
      }
      return "Enter the required purchase details.";
    }
    if (!description.trim()) {
      return "Enter a product description so Nobu can search Target.";
    }
    if (!price.trim() || !date.trim()) {
      return "Enter the price paid and purchase date.";
    }
    return "Enter the required purchase details.";
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
              className="n-product-entry-mode"
              data-testid="product-entry-mode"
            >
              <legend className="n-card-title">How do you want to identify the product?</legend>
              <div className="n-mode-toggle" role="radiogroup" aria-label="Product entry mode">
                <label className="n-mode-option">
                  <input
                    type="radio"
                    name="product_entry_mode"
                    value="exact"
                    checked={entryMode === "exact"}
                    onChange={() => setEntryMode("exact")}
                    data-testid="mode-exact"
                  />
                  <span>
                    <strong>Exact product</strong>
                    <span className="muted"> — Target URL or TCIN</span>
                  </span>
                </label>
                <label className="n-mode-option">
                  <input
                    type="radio"
                    name="product_entry_mode"
                    value="find"
                    checked={entryMode === "find"}
                    onChange={() => setEntryMode("find")}
                    data-testid="mode-find"
                  />
                  <span>
                    <strong>Help me find the product</strong>
                    <span className="muted"> — describe it and pick from Target candidates</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {entryMode === "exact" ? (
              <>
                <Field
                  id="target_product_url"
                  label={markLabel("Product URL", "product_url")}
                  hint="Optional if you enter a TCIN. Example: https://www.target.com/p/.../-/A-12345678"
                  error={
                    fieldMark("product_url") === "missing" && !tcin.trim()
                      ? "Add a Target product link, or enter a TCIN below."
                      : identity.errors.target_product_url && url.trim()
                        ? identity.errors.target_product_url
                        : undefined
                  }
                >
                  <Input
                    id="target_product_url"
                    name="target_product_url"
                    data-testid="input-url"
                    placeholder="https://www.target.com/p/.../-/A-12345678"
                    value={url}
                    onChange={(e) => onUrlChange(e.target.value)}
                    autoComplete="off"
                    invalid={
                      (fieldMark("product_url") === "missing" && !tcin.trim()) ||
                      Boolean(identity.errors.target_product_url && url.trim())
                    }
                  />
                </Field>

                <div className="grid-2">
                  <Field
                    id="target_item_id"
                    label={markLabel("TCIN", "target_item_id")}
                    hint="Optional if the Target product link includes A-TCIN"
                    error={
                      identity.errors.target_item_id &&
                      (url.trim() || tcin.trim())
                        ? identity.errors.target_item_id
                        : !identity.ok &&
                            !url.trim() &&
                            !tcin.trim()
                          ? identity.errors.identity
                          : undefined
                    }
                  >
                    <Input
                      id="target_item_id"
                      name="target_item_id"
                      data-testid="input-tcin"
                      value={tcin}
                      onChange={(e) => onTcinChange(e.target.value)}
                      autoComplete="off"
                      invalid={Boolean(
                        identity.errors.target_item_id &&
                          (url.trim() || tcin.trim()),
                      )}
                    />
                  </Field>
                  <Field
                    id="product_title"
                    label={markLabel("Product title", "product_description")}
                    hint={
                      titleSource === "link"
                        ? "Link-derived title — edit if needed (not a current price)"
                        : titleSource === "tcin"
                          ? "Placeholder until Nobu finds a better title"
                          : "Name from your order (optional)"
                    }
                  >
                    <Input
                      id="product_title"
                      name="product_title"
                      data-testid="input-title"
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
                  </Field>
                </div>
              </>
            ) : (
              <Field
                id="product_description"
                label={markLabel("Product description", "product_description")}
                hint='Example: "Apple AirPods" — Nobu will show Target candidates to choose from'
                required
                error={
                  fieldMark("product_description") === "missing" ||
                  fieldMark("product_url_or_tcin_or_description") === "missing"
                    ? "Describe the product so Nobu can search Target."
                    : undefined
                }
              >
                <Input
                  id="product_description"
                  name="product_description"
                  required
                  data-testid="input-description"
                  placeholder="Apple AirPods"
                  value={description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    if (!titleUserEdited.current) {
                      setTitle(e.target.value);
                    }
                  }}
                  invalid={
                    fieldMark("product_description") === "missing" ||
                    fieldMark("product_url_or_tcin_or_description") === "missing"
                  }
                />
                {/* Keep title in sync for server when find mode uses description */}
                <input type="hidden" name="product_title" value={title || description} />
              </Field>
            )}

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
                {entryMode === "exact"
                  ? EXACT_IDENTITY_SECTION_HEADING
                  : "Optional details"}
              </legend>
              <p className="muted">
                {entryMode === "exact"
                  ? "Nobu extracts the TCIN from your Target link when it can. Add a model number or UPC only if Nobu needs one to separate similar Target items."
                  : "Brand, model, color, or size help Nobu narrow Target candidates. You will still choose the exact product before monitoring starts."}
              </p>

              <div className="grid-2">
                {entryMode === "find" ? (
                  <Field
                    id="brand"
                    label="Brand"
                    hint="Optional"
                  >
                    <Input
                      id="brand"
                      name="brand"
                      data-testid="input-brand"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : (
                  <Field
                    id="model_number"
                    label={markLabel("Model number", "model_number")}
                    hint="Optional unless Nobu asks for one after discovery."
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
                )}
                {entryMode === "exact" ? (
                  <Field
                    id="upc_or_gtin"
                    label="UPC or GTIN"
                    hint="Optional unless Nobu asks for one after discovery."
                  >
                    <Input
                      id="upc_or_gtin"
                      name="upc_or_gtin"
                      data-testid="input-upc"
                      value={upc}
                      onChange={(e) => setUpc(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : (
                  <Field
                    id="model_number"
                    label="Model number"
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
                )}
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

              <div className="grid-2">
                <Field id="quantity" label="Quantity" hint="Optional">
                  <Input
                    id="quantity"
                    name="quantity"
                    data-testid="input-quantity"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                {entryMode === "find" ? (
                  <Field
                    id="upc_or_gtin"
                    label="UPC or GTIN"
                    hint="Optional"
                  >
                    <Input
                      id="upc_or_gtin"
                      name="upc_or_gtin"
                      data-testid="input-upc"
                      value={upc}
                      onChange={(e) => setUpc(e.target.value)}
                      autoComplete="off"
                    />
                  </Field>
                ) : (
                  <span />
                )}
              </div>

              <p className="muted" data-testid="identity-progressive-note">
                {entryMode === "exact"
                  ? "If Nobu cannot confirm one exact Target item from the URL/TCIN and third-party Target evidence, it will ask for one extra detail."
                  : "Nobu will show a short list of Target candidates. Monitoring starts only after you confirm the exact product."}
              </p>
            </fieldset>

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
              disabledReason={findDisabledReason()}
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
  showFixtureBanner = false,
}: {
  children: React.ReactNode;
  serverError?: {
    heading: string;
    body: string;
    nextAction: string;
    code: string;
  } | null;
  /** Only when fixture discovery gate is open (tests/e2e) — never for production users. */
  showFixtureBanner?: boolean;
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
