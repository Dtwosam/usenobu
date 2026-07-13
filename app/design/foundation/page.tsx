import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CurrencyInput,
  DateInput,
  DemoDataBanner,
  Disclosure,
  EmptyState,
  Field,
  FormError,
  IconButton,
  IconPlus,
  InlineNotice,
  Input,
  LoadingSkeleton,
  PageHeader,
  PriceSummary,
  ProductCard,
  SectionHeader,
  Select,
  StatusBadge,
  Stepper,
} from "@/ui";

const SWATCHES: { name: string; varName: string; color: string }[] = [
  { name: "canvas", varName: "--canvas", color: "#F6F5F0" },
  { name: "surface", varName: "--surface", color: "#FFFFFF" },
  { name: "ink", varName: "--ink", color: "#161A17" },
  { name: "brand", varName: "--brand", color: "#1F5A4A" },
  { name: "brand-soft", varName: "--brand-soft", color: "#E4EFEA" },
  { name: "accent", varName: "--accent", color: "#B69A62" },
  { name: "success", varName: "--success", color: "#197552" },
  { name: "warning", varName: "--warning", color: "#7A4F12" },
  { name: "danger", varName: "--danger", color: "#B3443B" },
  { name: "border", varName: "--border", color: "#E2E5DF" },
];

/**
 * Design-system gallery for Lane 7.5B1 proof.
 * Not a product screen redesign — components and shell only.
 */
export default function FoundationPage() {
  return (
    <div className="n-gallery" data-testid="foundation-gallery">
      <PageHeader
        eyebrow="Lane 7.5B1"
        title="Nobu design foundation"
        description="Reusable tokens, controls, and shell patterns. Product flows stay on existing screens until Lane 7.5B2."
      />

      <DemoDataBanner data-testid="foundation-demo-banner">
        <p>
          <strong>Demo data.</strong> Sample labels and prices on this page are
          fixtures for design proof — not live shopping results or savings claims.
        </p>
      </DemoDataBanner>

      <section className="n-gallery__section" aria-labelledby="tokens-heading">
        <SectionHeader
          title="Color tokens"
          description="Green-and-cream palette with restrained borders."
        />
        <h2 id="tokens-heading" className="visually-hidden">
          Color tokens
        </h2>
        <div className="n-gallery__swatches" data-testid="token-swatches">
          {SWATCHES.map((s) => (
            <div className="n-swatch" key={s.name}>
              <div
                className="n-swatch__chip"
                style={{ background: s.color }}
                title={s.varName}
              />
              <div className="n-swatch__label">
                {s.name}
                <br />
                {s.color}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="n-gallery__section" aria-labelledby="buttons-heading">
        <h2 id="buttons-heading">Buttons &amp; icon buttons</h2>
        <div className="n-gallery__row">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Loading</Button>
          <Button disabled disabledReason="Finish the form above to continue">
            Disabled
          </Button>
          <IconButton label="Add item">
            <IconPlus />
          </IconButton>
          <ButtonLink href="/purchases/new">Track a purchase</ButtonLink>
        </div>
      </section>

      <section className="n-gallery__section" aria-labelledby="forms-heading">
        <h2 id="forms-heading">Form controls</h2>
        <Card>
          <Field
            id="sample-name"
            label="Product name"
            hint="Use the name from your Target.com order."
          >
            <Input
              id="sample-name"
              name="sample-name"
              defaultValue="up&up Acetaminophen"
              autoComplete="off"
            />
          </Field>
          <Field
            id="sample-price"
            label="What you paid"
            required
            error="Enter the amount you paid so we can compare prices."
          >
            <CurrencyInput
              id="sample-price"
              name="sample-price"
              invalid
              defaultValue="12.99"
            />
          </Field>
          <Field id="sample-date" label="Purchase date">
            <DateInput id="sample-date" name="sample-date" defaultValue="2026-07-01" />
          </Field>
          <Field id="sample-region" label="State">
            <Select id="sample-region" name="sample-region" defaultValue="CA">
              <option value="CA">California</option>
              <option value="NY">New York</option>
              <option value="TX">Texas</option>
            </Select>
          </Field>
          <FormError data-testid="foundation-form-error">
            Check the highlighted fields, then try again. Your other answers are
            still here.
          </FormError>
        </Card>
      </section>

      <section className="n-gallery__section" aria-labelledby="status-heading">
        <h2 id="status-heading">Status &amp; badges</h2>
        <div className="n-gallery__row">
          <StatusBadge label="Watching for drops" tone="info" />
          <StatusBadge label="Possible savings" tone="success" />
          <StatusBadge label="Needs your review" tone="warning" />
          <StatusBadge label="Not eligible" tone="danger" />
          <Badge tone="brand">Target.com</Badge>
          <Badge tone="warning">Demo</Badge>
        </div>
      </section>

      <section className="n-gallery__section" aria-labelledby="stepper-heading">
        <h2 id="stepper-heading">Stepper</h2>
        <Stepper
          steps={[
            { id: "1", label: "Add purchase", state: "done" },
            { id: "2", label: "Confirm product", state: "current" },
            { id: "3", label: "Watch prices", state: "todo" },
          ]}
        />
      </section>

      <section className="n-gallery__section" aria-labelledby="cards-heading">
        <h2 id="cards-heading">Product &amp; price</h2>
        <div className="grid-2">
          <ProductCard
            title="up&up Acetaminophen 500mg"
            subtitle="Target.com · online purchase"
            meta="Paid $12.99 · 6 days left to request"
            badge={<StatusBadge label="Watching" tone="info" />}
          />
          <Card>
            <SectionHeader title="Price summary" description="Plain numbers only." />
            <PriceSummary
              purchasePrice="$12.99"
              observedPrice="$9.49"
              difference="$3.50"
              note="Target must verify the lower price. Nobu does not guarantee a refund."
            />
          </Card>
        </div>
      </section>

      <section className="n-gallery__section" aria-labelledby="notice-heading">
        <h2 id="notice-heading">Notices &amp; progressive disclosure</h2>
        <InlineNotice tone="info">
          <p>Prices come from a third-party shopping search, not an official Target API.</p>
        </InlineNotice>
        <InlineNotice tone="success">
          <p>We found a lower observed price. Review details before you contact Target.</p>
        </InlineNotice>
        <Disclosure title="Why we ask for your purchase date">
          <p>
            Target&apos;s adjustment window is typically 14 days from purchase. We only
            watch while that window is open.
          </p>
        </Disclosure>
        <Disclosure title="Technical evidence (advanced)">
          <p>
            Match evidence, provider IDs, and policy snapshots stay here so everyday
            screens stay simple.
          </p>
        </Disclosure>
      </section>

      <section className="n-gallery__section" aria-labelledby="empty-heading">
        <h2 id="empty-heading">Empty &amp; loading</h2>
        <Card>
          <EmptyState
            title="No purchases yet"
            description="Add a recent Target.com order once. We’ll watch for lower observed prices during the adjustment window."
            action={
              <ButtonLink href="/purchases/new">Track a purchase</ButtonLink>
            }
          />
        </Card>
        <Card>
          <LoadingSkeleton variant="title" />
          <LoadingSkeleton variant="text" />
          <LoadingSkeleton variant="text" width="80%" />
          <div style={{ height: "var(--space-4)" }} />
          <LoadingSkeleton variant="block" />
        </Card>
      </section>
    </div>
  );
}
