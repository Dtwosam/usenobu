import type { Metadata } from "next";
import { OkxMarketplaceLink } from "@/ui/OkxMarketplaceLink";
import { OkxFaq, OkxExampleCopy } from "./OkxGuideClient";

export const metadata: Metadata = {
  title: "Use Nobu with OKX.AI — Nobu",
  description:
    "Buy a Monitoring Pass, complete free Purchase Setup, redeem the pass, and manage post-purchase monitoring through OKX.AI Agent 5541.",
};

const SETUP_STEPS = [
  {
    title: "Open Nobu on OKX.AI",
    body: "Open Nobu, Agent 5541, on OKX.AI.",
  },
  {
    title: "Select Nobu Monitoring Pass",
    body: "Choose the paid Monitoring Pass service for one eligible purchase.",
  },
  {
    title: "Make one $0.99 payment",
    body: "Complete a single payment for the Monitoring Pass.",
  },
  {
    title: "Receive the Monitoring Pass",
    body: "After payment settles, you receive one Monitoring Pass. Buying the pass does not activate monitoring by itself.",
  },
  {
    title: "Continue to free Purchase Setup",
    body: "Use free Nobu Purchase Setup to prepare the purchase you want to monitor. No second payment is required.",
  },
  {
    title: "Confirm use of the pass",
    body: "Confirm that you want to use your Monitoring Pass for this setup journey.",
  },
  {
    title: "Describe the eligible purchase",
    body: "Describe the eligible purchase you want Nobu to watch.",
  },
  {
    title: "Confirm the exact product",
    body: "Select and confirm the exact product before monitoring can begin.",
  },
  {
    title: "Verify the email address",
    body: "Verify the alert email address where consented alerts may be sent.",
  },
  {
    title: "Give both required consents",
    body: "Give monitoring consent and email-alert consent before activation.",
  },
  {
    title: "Redeem the pass and activate monitoring",
    body: "Redeem the Monitoring Pass to activate scheduled monitoring for that confirmed, eligible purchase.",
  },
  {
    title: "Manage monitoring",
    body: "Check status, manage alerts, or stop monitoring through the conversation.",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "What is Nobu on OKX.AI?",
    a: "Nobu is listed on OKX.AI as Agent 5541. It is a post-purchase monitoring agent that watches the exact product after purchase and alerts you when a safely matched lower price may create an opportunity to request the difference from the retailer.",
  },
  {
    q: "Can I use Nobu without visiting the website?",
    a: "Yes. Through OKX.AI you can buy a Monitoring Pass, complete free Purchase Setup, redeem the pass to activate monitoring, and manage monitors through conversation. The UseNobu website remains available if you prefer a visual flow.",
  },
  {
    q: "What is the difference between Monitoring Pass and Purchase Setup?",
    a: "Monitoring Pass is the $0.99 paid service that issues one pass for one eligible purchase. Purchase Setup is free and walks you through confirming the pass, describing the purchase, selecting the exact product, verifying email, giving consent, and redeeming the pass to activate monitoring.",
  },
  {
    q: "Which steps are free?",
    a: "Purchase Setup is free: confirm use of the pass, describe the purchase, select the exact product, verify email, give required consents, redeem the pass, check status, manage email alerts, and stop monitoring. Only buying the Monitoring Pass is paid.",
  },
  {
    q: "What does the $0.99 payment cover?",
    a: "The payment issues one Monitoring Pass for one eligible purchase. It does not activate monitoring by itself. Activation happens later when you redeem the pass during free Purchase Setup after the product is confirmed and both consents are given.",
  },
  {
    q: "Does buying the Monitoring Pass start monitoring?",
    a: "No. Buying the pass only issues the pass. Monitoring becomes active only after you complete free Purchase Setup and redeem the pass for a confirmed, eligible purchase.",
  },
  {
    q: "Does payment guarantee a price drop?",
    a: "No. The payment issues a Monitoring Pass only. It does not guarantee a lower price, alert, refund, adjustment, or savings. Prices may stay the same, and matching fails closed when a lower price cannot be safely confirmed.",
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
        <p className="n-hero__eyebrow" data-testid="okx-agent-eyebrow">
          Live on OKX.AI · Agent 5541
        </p>
        <h1 id="okx-title" className="n-hero__title">
          Use Nobu with OKX.AI
        </h1>
        <p className="n-hero__lead" data-testid="okx-hero-lead">
          Buy a Monitoring Pass, complete free Purchase Setup, redeem the pass
          to activate monitoring, and manage alerts through a compatible
          AI-agent conversation.
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
          One Monitoring Pass — $0.99
        </h2>
        <p className="n-section-lead" data-testid="okx-payment-copy">
          The payment issues one Monitoring Pass for one eligible purchase. It does not activate monitoring by itself and does not guarantee a lower price, alert, refund, adjustment or savings. Purchase Setup remains free.
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
