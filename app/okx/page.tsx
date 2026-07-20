import type { Metadata } from "next";
import { OkxMarketplaceLink } from "@/ui/OkxMarketplaceLink";
import { OkxFaq, OkxExampleCopy } from "./OkxGuideClient";

export const metadata: Metadata = {
  title: "Use Nobu with OKX.AI — Nobu",
  description:
    "Set up a purchase, confirm the exact product, activate monitoring and manage alerts through a compatible AI-agent conversation.",
};

const SETUP_STEPS = [
  {
    title: "Use a supported AI-agent environment",
    body: "Open a compatible AI-agent environment that can work with Onchain OS and OKX.AI.",
  },
  {
    title: "Install Onchain OS",
    body: "Install the official Onchain OS tooling so your environment can reach OKX agent services.",
  },
  {
    title: "Sign in to Agentic Wallet",
    body: "Sign in to your Agentic Wallet so identity and any monitoring activation payment can be handled securely.",
  },
  {
    title: "Access OKX.AI",
    body: "Open OKX.AI from your supported environment to browse available agent services.",
  },
  {
    title: "Select Nobu",
    body: "Choose Nobu to monitor a confirmed purchase for a possible price difference after you buy.",
  },
  {
    title: "Complete free purchase preparation",
    body: "Describe the purchase, confirm the exact product, verify your alert email, and complete free preflight steps before activation.",
  },
  {
    title: "Activate monitoring",
    body: "When you are ready, activate monitoring for one confirmed and eligible purchase. Activation uses a one-time $0.99 payment.",
  },
  {
    title: "Manage the monitor",
    body: "Check status, list active monitors, enable or disable email alerts, or stop monitoring through the conversation.",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "What is Nobu on OKX.AI?",
    a: "Nobu is an AI agent that monitors the exact product after purchase and alerts you when a safely matched lower price may create an opportunity to request the difference from the retailer.",
  },
  {
    q: "Can I use Nobu without visiting the website?",
    a: "Yes. Compatible AI-agent environments can set up a purchase, confirm the product, activate monitoring, and manage monitors through conversation. The UseNobu website remains available if you prefer a visual flow.",
  },
  {
    q: "Which actions are free?",
    a: "Discovery, product confirmation, email verification, preflight checks, status checks, listing monitors, and email-alert preference changes are free. Scheduled monitoring activation for one purchase requires the one-time $0.99 payment.",
  },
  {
    q: "What does the $0.99 payment cover?",
    a: "It activates scheduled monitoring for one confirmed and eligible purchase. It does not guarantee a lower price, alert, refund, adjustment, or savings.",
  },
  {
    q: "Does payment guarantee a price drop?",
    a: "No. Payment only activates monitoring. Prices may stay the same, and matching fails closed when a lower price cannot be safely confirmed.",
  },
  {
    q: "Does Nobu contact Target for me?",
    a: "No. Nobu shows the possible difference and Target’s official contact path. You contact Target. Target verifies eligibility and decides.",
  },
  {
    q: "What happens when a price cannot be safely matched?",
    a: "Nobu does not treat an uncertain observation as a lower price. Monitoring continues within the supported period, or you see that no safe match is available.",
  },
  {
    q: "Why does Nobu verify my email?",
    a: "Email verification confirms where consented alerts may be sent. Nobu does not use your Target password or retailer login.",
  },
  {
    q: "Can I disable email alerts?",
    a: "Yes. You can disable email alerts for a monitor at any time through OKX.AI or on the website when signed in.",
  },
  {
    q: "Can I stop monitoring?",
    a: "Yes. Stopping ends scheduled checks for that purchase. It does not submit a retailer request or guarantee any adjustment.",
  },
  {
    q: "Does Nobu need my Target password?",
    a: "No. Nobu never collects Target passwords, card details, bank credentials, or 2FA codes, and does not access retailer accounts.",
  },
  {
    q: "Where do observed prices come from?",
    a: "Prices are observed through SerpApi Google Shopping results filtered toward Target. These are third-party observations, not an official Target API.",
  },
  {
    q: "Which purchases are supported?",
    a: "Currently eligible Target.com and Target app purchases in the verified supported geography. Target Plus is excluded. Exact-product confirmation is required.",
  },
] as const;

const RESOURCES = [
  {
    title: "A2MCP Guide",
    href: "https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp",
    note: "Official OKX documentation for free and paid A2MCP agent endpoints.",
  },
  {
    title: "ASP Introduction",
    href: "https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction",
    note: "Official overview of Agent Service Provider listing and suitability.",
  },
  {
    title: "ASP Registration",
    href: "https://web3.okx.com/onchainos/dev-docs/okxai/registerasp",
    note: "Official registration fields for agent services on OKX.AI.",
  },
  {
    title: "Payments — HTTP API",
    href: "https://web3.okx.com/onchainos/dev-docs/payments/api-http",
    note: "Official seller-side payment challenge and settlement HTTP flow.",
  },
] as const;

export default function OkxGuidePage() {
  return (
    <div className="n-screen n-screen--okx" data-testid="okx-guide-page">
      <section className="n-hero" aria-labelledby="okx-title">
        <h1 id="okx-title" className="n-hero__title">
          Use Nobu with OKX.AI
        </h1>
        <p className="n-hero__lead" data-testid="okx-hero-lead">
          Set up a purchase, confirm the exact product, activate monitoring and
          manage alerts through a compatible AI-agent conversation.
        </p>
        <div className="n-hero__actions">
          <OkxMarketplaceLink data-testid="cta-okx-marketplace" />
        </div>
      </section>

      <section className="n-home-section" aria-labelledby="setup-title">
        <h2 id="setup-title" className="n-section-title">
          Setup steps
        </h2>
        <ol className="n-okx-setup" data-testid="okx-setup">
          {SETUP_STEPS.map((step) => (
            <li key={step.title} className="n-okx-setup__item">
              <h3 className="n-okx-setup__title">{step.title}</h3>
              <p className="n-okx-setup__body">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="n-help-panel" style={{ marginTop: "1.5rem" }}>
          <h3 className="n-okx-setup__title">Example request</h3>
          <OkxExampleCopy
            text="Use Nobu to monitor a recent Target purchase for a possible price difference."
          />
        </div>
      </section>

      <section className="n-home-section" aria-labelledby="payment-title">
        <h2 id="payment-title" className="n-section-title">
          One-time monitoring activation — $0.99
        </h2>
        <p className="n-section-lead" data-testid="okx-payment-copy">
          The payment activates scheduled monitoring for one confirmed and
          eligible purchase. It does not guarantee a lower price, alert, refund,
          adjustment or savings.
        </p>
      </section>

      <section className="n-home-section" aria-labelledby="manage-title">
        <h2 id="manage-title" className="n-section-title">
          Monitor-management actions
        </h2>
        <ul className="n-list" data-testid="okx-manage-list">
          <li>Check monitoring status</li>
          <li>List active monitors</li>
          <li>Enable email alerts</li>
          <li>Disable email alerts</li>
          <li>Stop monitoring</li>
        </ul>
      </section>

      <section
        id="faq"
        className="n-home-section"
        aria-labelledby="faq-title"
      >
        <h2 id="faq-title" className="n-section-title">
          FAQ
        </h2>
        <OkxFaq items={[...FAQ_ITEMS]} />
      </section>

      <section className="n-home-section" aria-labelledby="resources-title">
        <h2 id="resources-title" className="n-section-title">
          Official OKX resources
        </h2>
        <ul className="n-resource-list" data-testid="okx-resources">
          {RESOURCES.map((r) => (
            <li key={r.href}>
              <a
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {r.title}
                <span aria-hidden> ↗</span>
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              <p>{r.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
