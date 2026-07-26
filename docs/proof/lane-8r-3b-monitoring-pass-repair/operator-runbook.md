# Lane 8R.3B — operator runbook

Every step below is **state-changing** and was deliberately **not executed** in Lane 8R.3B. Run them in this order, and stop after step 3 unless you explicitly decide to continue.

**Never** paste a private key, recovery phrase, payment header, `PAYMENT-SIGNATURE` value, `connection_token`, or `monitoring_pass_token` into a chat, a file, or a commit. Placeholders below are written as `<LIKE_THIS>`.

**Prerequisite state as of 2026-07-26:** ASP `#5541` is `approvalDisplayStatus: 5` ("Listing rejected"). Service `33561` points at `https://usenobu.vercel.app/v1/agent` (correct). Service `35958` points at `https://usenobu.vercel.app/v1/agent/start-monitoring` — **stale**, and OKX's own validator reports `valid: false` for it. The repaired endpoints are live and validated.

---

## Step 1 — Execute the single ASP metadata update

One `agent update` covering **both** services. This is an on-chain write: it costs gas and re-triggers OKX QA on the listing. It does **not** activate or resubmit.

Confirm the CLI and identity first (read-only):

```
onchainos agent get-agents --agent-ids 5541
onchainos agent service-list --agent-id 5541
```

Then run the update. Service ids and the agent id must not change; only the fields below.

**Service `33561` — keep the name `Nobu Purchase Setup`, replace the description with exactly:**

```
Free A2MCP service for setting up and managing Target post-purchase monitoring. Send a JSON action with its required fields; an empty call returns supported actions and examples. Supports purchase setup, product confirmation, email verification, consent, eligibility, Monitoring Pass redemption, status, alert preferences, stopping and revocation. It does not charge or activate monitoring without a valid pass.
```

**Service `35958` — set all four fields:**

| Field | Value |
|---|---|
| name | `Nobu Monitoring Pass` |
| fee | `0.99` |
| endpoint | `https://usenobu.vercel.app/v1/agent/monitoring-pass` |

description, exactly:

```
Paid $0.99 A2MCP service that issues one Nobu Monitoring Pass after verified OKX x402 payment. First call returns 402 Payment Required; payment replay returns the pass. The pass can activate monitoring for one confirmed eligible Target purchase after free setup. An ineligible purchase does not consume it. Payment does not guarantee a price drop, alert, refund, adjustment or savings.
```

Check the exact flag names for your CLI build before running — `onchainos agent update --help`. The update must be a single call carrying both service entries as `operation: "update"` deltas against the existing service ids, in the shape that `--help` documents. Do **not** create new services, and do **not** include `agent activate`.

> If `agent update --help` does not offer a way to express both service updates in one call, **stop and report it** rather than running two updates or guessing a payload.

---

## Step 2 — Read back immediately

```
onchainos agent get-agents --agent-ids 5541
onchainos agent service-list --agent-id 5541
```

Confirm, and record:

- agent id is still `5541` and `newAgentId` is null (no second ASP was created);
- service ids are still `33561` and `35958`;
- `35958.endpoint` is now `https://usenobu.vercel.app/v1/agent/monitoring-pass`;
- `35958.name` is `Nobu Monitoring Pass` and `35958.fee` is `0.99`;
- both descriptions match the text above byte for byte.

---

## Step 3 — Record QA status, then stop

Record `approvalDisplayStatus`, `approvalLabel`, and any `approvalRemark` returned after the update.

**Run no further state-changing command without explicit authorization.** In particular, do not run `agent activate`, `agent deactivate`, or a second `agent update`.

---

## Step 4 — Designated routing and official validation (read-only)

```
onchainos agent designated-route --provider 5541
onchainos agent x402-check --endpoint https://usenobu.vercel.app/v1/agent/monitoring-pass --agent-id 5541
onchainos agent x402-check --endpoint https://usenobu.vercel.app/v1/agent/monitoring-pass --agent-id 5541 --body '{}'
```

Expect `valid: true` from both `x402-check` calls, and the new endpoint in the routing output. (Both already pass against the live endpoint today; this re-confirms them against the updated listing.)

---

## Step 5 — One genuine $0.99 payment and replay

Requires an eligible adult operator using their own funded OKX wallet, holding USDT on X Layer (`eip155:196`). Amount is `990000` base units = `$0.99`.

**5a. Get a fresh challenge** and keep the header value verbatim:

```
curl -sS -D - -o /dev/null -X POST https://usenobu.vercel.app/v1/agent/monitoring-pass
```

Copy the `PAYMENT-REQUIRED:` value as `<RAW_402>`. It is valid for `maxTimeoutSeconds: 300` — if you take longer, fetch a fresh one rather than reusing a stale challenge.

**5b. Confirm the wallet session:**

```
onchainos wallet status
```

**5c. Sign** (the CLI decodes, signs, and assembles the header itself — never hand-assemble):

```
onchainos payment pay --payload '<RAW_402>'
```

It returns `{authorization_header, header_name, scheme, wallet}`. `header_name` will be `PAYMENT-SIGNATURE`.

**5d. Replay the same request** with that header:

```
curl -sS -D - -X POST \
  -H "PAYMENT-SIGNATURE: <AUTHORIZATION_HEADER>" \
  https://usenobu.vercel.app/v1/agent/monitoring-pass
```

Expect `HTTP 200` with `status: MONITORING_PASS_ISSUED`, a `monitoring_pass_id`, and a one-time `monitoring_pass_token`.

> **The token is returned exactly once.** Store it somewhere private immediately. Do not paste it into chat, a commit, or a proof file — record only the `monitoring_pass_id` and the fact that a token was returned.

If you instead get `status: PAYMENT_SETTLEMENT_PENDING`, settlement is still confirming and **no pass exists yet**. Replay the identical request with the identical header later; it will resolve to the same pass and will not charge again.

**5e. Redeem it** (optional, and only against a genuine eligible purchase). Complete the free flow — `DISCOVER_PRODUCT` → `CONFIRM_PRODUCT` → `BEGIN_EMAIL_VERIFICATION` → `VERIFY_EMAIL_CODE` → `PREFLIGHT_MONITORING` — to obtain `<QUOTE_ID>`, `<CONNECTION_ID>` and `<CONNECTION_TOKEN>`, then:

```
curl -sS -X POST -H "Content-Type: application/json" \
  -d '{"action":"REDEEM_MONITORING_PASS","monitoring_pass_id":"<PASS_ID>","monitoring_pass_token":"<PASS_TOKEN>","quote_id":"<QUOTE_ID>","connection_id":"<CONNECTION_ID>","connection_token":"<CONNECTION_TOKEN>"}' \
  https://usenobu.vercel.app/v1/agent
```

A failed redemption does **not** consume the pass.

---

## Step 6 — OKX.ai User-role test

Using a legitimate OKX.ai **User-role** identity belonging to an eligible adult operator (this account currently owns only ASP `#5541`; creating a User identity is a separate on-chain registration and a separate decision), send exactly:

```
I would like to use the services of agent ID 5541
```

Record, without exposing values: whether agent `5541` resolves; whether both services appear with correct names, fees and endpoints; whether the free service returns a usable next step; whether the paid service returns its payment challenge; whether payment replay returns the Monitoring Pass; and whether any timeout occurs.

---

## Step 7 — Review before any activation decision

Collect the outputs of steps 2–6 and review them together. **Activation or resubmission of ASP `#5541` is a separate, explicit decision and a separate lane.** Nothing in this runbook authorizes it.
