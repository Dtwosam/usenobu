# Lane 8-R2 — Canonical Proof Acceptance and Policy-Ops Durability Audit

**Lane:** 8-R2  
**Mode:** Verification-first (no product feature implementation)  
**Audit date:** 2026-07-19  
**Baseline commit:** `24c59f5517122adca3ec3961d410aa517e807f67`  
**Branch:** `master`  
**Final verdict:** **`NOBU_LANE_8_R2_BLOCKED_POLICY_STATE_NOT_DURABLE`**

---

## 1. Baseline commit and repository state

```text
git rev-parse HEAD
24c59f5517122adca3ec3961d410aa517e807f67

git branch --show-current
master

git status --short (at audit start)
 M docs/nobu-build-order.md
 M docs/nobu-current-state.md
 M docs/proof/okx/README.md
 M docs/proof/policy-operations-r1a/README.md
?? docs/proof/okx/avatar-verify-v2.json
?? docs/proof/okx/gate5-resubmit-activate-redacted.json
?? docs/proof/okx/gate5-update-avatar-redacted.json
?? docs/proof/okx/gate5-upload-v2-redacted.json
?? docs/proof/okx/lane8-avatar-resubmit-summary.json
?? docs/proof/okx/nobu-asp-avatar-v2.png
```

**Dirty-tree handling:** Pre-existing Lane 8 avatar-resubmission files and modified documentation were preserved exactly. They were not staged, edited, reverted, or committed. Additional dirty `docs/proof/policy-operations-r1a/README.md` (post-R1A polish) was also left untouched.

**Safety:** Dirty state is the known Lane 8 set only — lane proceeded.

**Agent `5541` / OKX listing:** Not inspected for mutation beyond confirming this lane made no OKX or agent-listing changes. **Untouched.**

---

## 2. Canonical proof acceptance matrix

Source of R1A production evidence:

| Artifact | Path |
|---|---|
| Response body | `docs/proof/policy-operations-r1a/prod-agent-probe-redacted.json` |
| Health | `docs/proof/policy-operations-r1a/prod-health-redacted.json` |
| R1A README | `docs/proof/policy-operations-r1a/README.md` |
| R2 request reconstruction | `docs/proof/policy-operations-r2/r1a-request-reconstructed-redacted.json` |

| # | Required evidence | Status | Evidence |
|---|---|---|---|
| 1 | Request used `POST https://usenobu.vercel.app/v1/agent` | **PASS** | R1A session command + R2 reconstructed request archive; production alias confirmed via Vercel inspect |
| 2 | Action was `CHECK_CONFIRMED_PURCHASE` | **PASS** | Reconstructed request body (not in response JSON; request was not originally archived as a file — reconstructed in R2 without re-query) |
| 3 | Exact deployment and source commit recorded | **PASS with note** | Deployment: `usenobu-e9x1qi35w-dtwoflicks-2878s-projects.vercel.app` / id `dpl_3TvMaGr1aWXFa5kUeEsTw4KFvFCm`. Source tree became commit `24c59f5` immediately after deploy; deploy timestamp slightly precedes commit timestamp (local tree deploy then commit) |
| 4 | Request and response archived and redacted | **PASS with note** | Response committed in R1A. Request reconstructed and archived in R2 (no secrets; no new SerpApi call) |
| 5 | HTTP status recorded | **PASS with note** | Successful `Invoke-RestMethod` implies 2xx; R2 records **HTTP 200** for the R1A agent probe by session fact. Status was not stored inside the response JSON body |
| 6 | Response was `PRICE_DROP_DETECTED` | **PASS** | `prod-agent-probe-redacted.json` `status` |
| 7 | Purchase price `$35.00` | **PASS** | `purchase_price: 35` |
| 8 | Observed price `$29.99` | **PASS** | `observed_target_price: 29.99` |
| 9 | Seller evidence identifies Target | **PASS** | `matched_product.seller: "Target"`, `seller_kind: "target"` |
| 10 | Exact-product match evidence present | **PASS** | `match_tier: "exact_model_variant"`, `match_evidence: ["model_from_title","title_sim=1.000"]` (matched offer TCIN null in payload; request carried TCIN `54191097`) |
| 11 | SerpApi identified as third-party observation | **PASS** | `provider: "SerpApi"`, `price_source_type: "THIRD_PARTY_SEARCH_OBSERVATION"`, disclaimer third-party language |
| 12 | Policy ID, version, verification timestamp | **PASS** | `policy_id`, `policy_version: "v1"`, `policy_verified_at: "2026-07-19T18:00:00.000Z"` |
| 13 | Target remains final decision-maker | **PASS** | `final_decision_by: "Target"` |
| 14 | No fixture / diagnostic route / synthetic provider | **PASS** | Canonical public route `/v1/agent`; live production host; `serpapi_configured: true` on health; response is live shopping match shape |
| 15 | SerpApi search consumption recorded | **PARTIAL / gap** | Not present in A2MCP response or R1A artifacts. Code path for live check always performs at least one `searchShopping`; may add ≤1 immersive enrich. Exact count for the R1A probe is **not instrumented or archived**. Re-running would not add a consumption field to the response without a code change — **no second SerpApi query in R2** |

### Canonical acceptance decision

**Accepted.** The material live-acceptance gap (canonical route returning a genuine `PRICE_DROP_DETECTED` with Target match, third-party provenance, and policy metadata) is closed by the existing 2026-07-19 proof.

Secondary archival gaps (request file, explicit HTTP status line, exact SerpApi unit count) are documented and partially filled without a new live price query. They do **not** overturn acceptance of the price-drop proof itself.

**Another SerpApi request used in R2:** **No.**

---

## 3. Production persistence architecture

### Code paths (static inspection)

| Record type | Write path in code | Production backend |
|---|---|---|
| Policy operations state (A2MCP / health) | `src/policy/operations/memory-store.ts` via `runMemoryPolicyReviewScheduler` / `getMemoryPolicyRuntime` in `src/a2mcp/check-service.ts`, `app/health/route.ts` | **In-process module memory only** |
| Policy operations state (owner API / UI) | `src/policy/operations/store.ts` via `getWebDatabase()` | SQLite file |
| Owner alerts | `policy_owner_alerts` table in SQLite store; memory alerts in memory-store | SQLite **or** process memory |
| Pending reviews | `policy_pending_reviews` (SQLite) / memory array | SQLite **or** process memory |
| Review events | `policy_review_events` (SQLite only) | SQLite |

### Where SQLite actually lives on Vercel

`src/web/db.ts` → `resolveWebDbPath()`:

- If `NOBU_DB_PATH` set → that path  
- Else if `VERCEL=1` → **`/tmp/nobu.web.sqlite`**  
- Else local → `data/nobu.web.sqlite`

**`/tmp` on Vercel is ephemeral per instance lifecycle.** It does not survive:

- cold starts that land on a different instance without shared volume  
- redeployments  
- multi-instance concurrency as a single source of truth  

### Production environment (names only)

From `vercel env ls production` (values never recorded):

| Present | Absent (material for durability/ops) |
|---|---|
| `SERPAPI_API_KEY`, `GROQ_API_KEY`, `NOBU_AI_MODEL` | `OWNER_OPS_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `NOBU_DB_PATH` |

Architecture docs mention PostgreSQL for deployed persistence; **no production Postgres wiring exists for policy operations.**

### Split-brain note

- Free A2MCP evaluation uses **memory-store**, not the owner SQLite path.  
- Owner `UNCHANGED` updates SQLite (`/tmp` on Vercel), **not** the A2MCP memory seed.  
- Even if owner SQLite were durable, A2MCP would not automatically share that state without an integration that does not exist today.

---

## 4. Durability tests performed

### Local (logic only — not production durability)

```text
npx vitest run tests/policy/policy-operations.test.ts tests/policy/freshness.test.ts
→ 2 files, 19 tests passed
```

Covers: CURRENT/CHECK_DUE/SOURCE_UNAVAILABLE/CHANGE_DETECTED/RETIRED rules; memory + in-memory SQLite owner `UNCHANGED`; alert idempotency; unauthorized/missing-secret auth helpers.

**These prove algorithm correctness, not production durability.**

### Production probes (R2; no SerpApi)

| Probe | Result | Artifact |
|---|---|---|
| `GET /v1/owner/policy-status` no auth | **HTTP 503** `{"error":"owner_ops_secret_not_configured"}` | `docs/proof/policy-operations-r2/prod-owner-status-no-auth-redacted.json` |
| `GET /v1/owner/policy-status` bad bearer | **HTTP 503** same (secret not configured; auth never reaches bearer compare) | `…/prod-owner-status-bad-bearer-redacted.json` |
| `POST /v1/owner/policy-scheduler` no auth | **HTTP 503** same | `…/prod-owner-scheduler-no-auth-redacted.json` |
| `GET /owner/policy` | **HTTP 200**; shows CURRENT; documents env **names** only; **no bearer token value** | `…/prod-owner-page-redacted.json` |
| `GET /health` policy fields | `policy_review_state: CURRENT` from **memory** seed | `…/prod-health-policy-fields-redacted.json` |
| Production env names | No owner secret; no durable DB path | `…/prod-env-names-redacted.json` |

### Planned reversible owner workflow — **blocked, not executed**

Required sequence (status → CHECK_DUE → `UNCHANGED` → CURRENT → cold start/redeploy recheck) **could not be run in production** because:

1. `OWNER_OPS_SECRET` / `CRON_SECRET` are **not configured** → all owner mutations return 503.  
2. Even if secrets were set, storage is `/tmp` SQLite + separate process memory for A2MCP — durability would still fail static architecture criteria.

**Not performed in production (by design of this audit):**

- Forced CHECK_DUE transition  
- Authorized `UNCHANGED`  
- Redeploy to prove survival  
- Concurrent multi-instance write/read  

**Do not** mark RETIRED or fake material change — complied.

---

## 5. Cold-start / redeployment evidence

| Claim | Result |
|---|---|
| Owner action survives a separate production request | **Unproven / blocked** — no authorized write possible without secret |
| Owner action survives cold start | **Architecturally fail** — `/tmp` + process memory |
| Owner action survives redeployment | **Architecturally fail** — no external durable store; redeploy clears `/tmp` and memory |
| Multi-instance consistency | **Architecturally fail** — each instance has private `/tmp` and memory |

Static code + env inspection is sufficient to reject durability without performing a destructive redeploy solely for this audit.

---

## 6. Owner-auth and alert-idempotency evidence

| Check | Local | Production |
|---|---|---|
| Missing secret → 503 | Unit test pass | **Confirmed 503** `owner_ops_secret_not_configured` |
| Wrong bearer → 401 when secret set | Unit test pass | **Not reachable** — secret unset short-circuits to 503 before compare |
| Alert idempotency (one active per key) | Memory + SQLite unit tests pass | **Not runnable** without secret + durable store |
| Secrets not in public responses | Redact tests; page has env **names** only | **No secret values** in owner page or 503 bodies |

---

## 7. Exact blockers

1. **Production policy-ops state is not durable.**  
   - A2MCP/health: in-process memory (`memory-store.ts`).  
   - Owner API: SQLite under **`/tmp/nobu.web.sqlite`** on Vercel (ephemeral).  
   - No `DATABASE_URL` / external durable store configured or used by policy ops.

2. **Owner runtime write path is not operable in production.**  
   - Neither `OWNER_OPS_SECRET` nor `CRON_SECRET` is set in Vercel production env.  
   - `UNCHANGED`-without-redeploy cannot be exercised on production today.

3. **A2MCP and owner stores are not the same backing store.**  
   - Even a durable owner SQLite would not update free-endpoint evaluation until shared.

4. **Secondary archival gap (non-blocking for price-drop acceptance):** exact SerpApi search unit count for the R1A probe was never instrumented in the response.

---

## 8. Whether another SerpApi query was consumed

**No.** R2 used only static inspection, local unit tests, and non-SerpApi production HTTP probes (health, owner routes, owner page).

---

## 9. Exact next lane

**Lane 8-R2A — Durable policy-operations store (implementation; for Claude)**

Smallest exact implementation scope:

1. Introduce a **production-durable** backend for policy operations tables (e.g. Vercel Postgres / Neon / other non-ephemeral store already acceptable to Nobu ops — **not** `/tmp` SQLite, **not** process memory alone).  
2. Wire **both** owner routes and A2MCP/health policy runtime to that single store (or a shared read path).  
3. Configure `OWNER_OPS_SECRET` (or `CRON_SECRET`) in production.  
4. Prove with redacted production evidence:  
   - unauthorized → 401 when secret set;  
   - scheduler → at most one active alert;  
   - `UNCHANGED` → `CURRENT`;  
   - state survives **new request**, **cold start**, and **redeploy**.  
5. Do **not** change Agent `5541`, OKX listing, retailers, or matching fail-closed rules.  
6. Do **not** silently auto-apply material policy changes.

Optional follow-on (not R2A required): instrument SerpApi search count on A2MCP responses for future proofs.

After 8-R2A durability PASS → resume **8-R3 OKX listing resolution** (agent `5541` under review), then **8-R4 deadline**, then **Lane 9**.

---

## 10. Final verdict

### `NOBU_LANE_8_R2_BLOCKED_POLICY_STATE_NOT_DURABLE`

| Gate | Outcome |
|---|---|
| A. Canonical production-proof acceptance | **PASS** — existing R1A live `PRICE_DROP_DETECTED` accepted; no re-query |
| B. Policy-operations durability | **FAIL / unproven in production** — ephemeral memory + `/tmp` SQLite; owner secret absent |

---

## Exact proposed source-of-truth updates (do not apply in this lane)

### `docs/nobu-current-state.md` (proposal only)

- Record Lane 8-R2 audit: **BLOCKED_POLICY_STATE_NOT_DURABLE** at audit commit (this document).  
- Canonical live `PRICE_DROP_DETECTED` on `/v1/agent` **accepted** from R1A proof (AirTag $35 → $29.99, 2026-07-19).  
- Policy ops durability is **not** production-ready: memory + `/tmp` SQLite; no owner secret in prod.  
- Next implementation: **8-R2A durable policy store**.  
- Agent `5541` still under review; listing untouched.

### `docs/nobu-build-order.md` (proposal only)

- Close 8-R2 audit as blocked on durability.  
- Insert **8-R2A — Durable policy-operations store** before 8-R3.  
- Keep 8-R3 OKX / 8-R4 deadline / Lane 9 after durability PASS.

---

## Appendix — commands run

```text
git rev-parse HEAD
git branch --show-current
git status --short
git show 24c59f5 --stat
npx vercel inspect usenobu.vercel.app
npx vercel env ls production
npx vitest run tests/policy/policy-operations.test.ts tests/policy/freshness.test.ts
# Production HTTP (no SerpApi):
GET  https://usenobu.vercel.app/health
GET  https://usenobu.vercel.app/v1/owner/policy-status
GET  https://usenobu.vercel.app/v1/owner/policy-status  (bad bearer)
POST https://usenobu.vercel.app/v1/owner/policy-scheduler
GET  https://usenobu.vercel.app/owner/policy
git diff --check  # on new audit/proof paths
git status --short
```

**Stop rule:** No command failures required a stop; production owner writes intentionally not attempted beyond unauthenticated probes.

---

## Hard locks compliance

- Agent `5541` / OKX listing / ASP: **untouched**  
- Registered endpoint/service/fee: **untouched**  
- No second retailer; matching not weakened  
- No manufactured price drop; **no extra SerpApi spend**  
- No application/production code changes in this verification lane  
