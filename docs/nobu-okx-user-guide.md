# Nobu on OKX.AI — customer guide

**Status:** ACTIVE  
**Aligned:** Lane 8R.2  
**Public page:** `/okx` on UseNobu

This guide matches the public customer experience. It is not technical API documentation.

## What you can do

Set up a purchase, confirm the exact product, activate monitoring, and manage alerts through a compatible AI-agent conversation.

## Setup sequence

Use current official OKX / Onchain OS information only. Do not invent marketplace menu names.

1. **Use a supported AI-agent environment**  
   Open an environment that can work with Onchain OS and OKX.AI.

2. **Install Onchain OS**  
   Install the official Onchain OS tooling so your environment can reach OKX agent services.

3. **Sign in to Agentic Wallet**  
   Sign in so identity and any monitoring activation payment can be handled securely.

4. **Access OKX.AI**  
   Open OKX.AI from your supported environment to browse available agent services.

5. **Select Nobu (Agent 5541)**
   Choose Nobu. Nobu will list **two services** — do not assume which one you need from the agent alone.

6. **Choose a service**
   - **Nobu Purchase Setup (33561)** — free. Purchase setup, continuation after a pass is issued, one-time checks, and monitor management. Does not sell a pass.
   - **Nobu Monitoring Pass (35958)** — **0.99 USDT** for one pass. No product details, email, wallet address, or alert threshold are needed before payment. Buying the pass does **not** activate monitoring.

7. **If you bought a pass, continue free Purchase Setup**
   Describe the purchase, confirm the exact product, verify your alert email, complete free preflight, then redeem the pass to activate scheduled monitoring for one confirmed and eligible purchase. If the purchase turns out not to be eligible, the pass is **not** used up.

8. **Manage the monitor**  
   Check status, list active monitors, enable or disable email alerts, or stop monitoring.

### Example request

Label as **Example request** only:

```
Use Nobu to monitor a recent Target purchase for a possible price difference.
```

## Nobu Monitoring Pass — one-time $0.99

A Monitoring Pass activates scheduled monitoring for **one confirmed and eligible purchase**. It does **not** guarantee a lower price, alert, refund, adjustment, or savings.

You can buy a pass at any time — no setup is required first. A pass is only used up when it successfully activates monitoring, so a purchase that turns out to be ineligible leaves your pass intact and redeemable.

Payment uses the official OKX agent payment flow (x402). Settlement verification is performed by Nobu’s server using official OKX seller APIs when credentials are configured.

## Free vs paid

| Service | ID | Price | Endpoint (registered) |
|---|---|---|---|
| Nobu Purchase Setup | 33561 | free | `https://usenobu.vercel.app/v1/agent` |
| Nobu Monitoring Pass | 35958 | 0.99 USDT | `https://www.usenobu.xyz/v1/agent/monitoring-pass` |

**Free (33561):** purchase setup, pass handoff continuation, discovery, exact confirmation, email verification, preflight/eligibility, **redeeming a Monitoring Pass**, status, list monitors, enable/disable email alerts, stop monitoring, revoke connection. Does not sell a Monitoring Pass.

**Paid (35958):** issues exactly one Monitoring Pass. Payment alone does not activate monitoring. No service parameters are required before payment.

## Monitor-management actions

- Check monitoring status  
- List active monitors  
- Enable email alerts  
- Disable email alerts  
- Stop monitoring  

## Truth boundary

- Nobu does **not** contact Target.  
- You contact Target using the official contact path.  
- Target verifies eligibility and decides.  
- Observed prices are third-party SerpApi observations, not an official Target API.  
- Target is the only retailer currently supported.

## Official OKX resources

| Resource | Relevance |
|---|---|
| [A2MCP Guide](https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp) | Free and paid A2MCP agent endpoints |
| [ASP Introduction](https://web3.okx.com/onchainos/dev-docs/okxai/asp-introduction) | Agent Service Provider listing overview |
| [ASP Registration](https://web3.okx.com/onchainos/dev-docs/okxai/registerasp) | Registration fields for agent services |
| [Payments — HTTP API](https://web3.okx.com/onchainos/dev-docs/payments/api-http) | Seller-side payment challenge and settlement |

Open links in a new tab. Do not paste large excerpts of OKX documentation here.

## Website alternative

Prefer a visual flow? Use the UseNobu website: [https://usenobu.vercel.app](https://usenobu.vercel.app) — start at **Monitor a purchase**.
