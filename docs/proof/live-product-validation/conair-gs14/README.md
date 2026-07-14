# Sprint A.2 — Conair GS14 live product matching diagnosis

**Date:** 2026-07-14  
**Verdict:** `NOBU_REVIEW_SAFE_A_2_PASS`  
**Product:** Conair ExtremeSteam Handheld Garment Steamer · Model GS14 · TCIN 87470797 · UPC 074108469755  

## Gate 4 — Root cause

**Primary:** `MATCHER_FIELD_MAPPING_DEFECT`

Enrollment matching already used hierarchy **URL → TCIN → model → UPC**, but **locked-fingerprint monitoring** (`offerMatchesLockedFingerprint`) **did not accept exact Target URL** and effectively required TCIN/model/UPC fields on the *observation* offer. SerpApi Target offers often expose a Target merchant URL (or title model token) without structured `model_number`/`upc` fields → generic `insufficient_identity` / “could not confirm the exact product.”

Identifiers were **not** lost in AI → form → fingerprint for a well-labeled purchase text (Gate 1).

## Gate 1 — Identifier survival

| Field | AI extract | Locked fingerprint | OK |
|---|---|---|---|
| Model GS14 | GS14 | GS14 | yes |
| TCIN 87470797 | 87470797 | 87470797 | yes |
| UPC 074108469755 | 074108469755 | 074108469755 | yes |
| Target URL A-87470797 | present | present | yes |

Session rehydration still persists fingerprint columns + `fingerprint_json` (existing Sprint A.1 cookie repair). No SESSION_IDENTIFIER_LOSS proven for this path.

## Gate 2 — Query

**Generated:** `Conair GS14 Target`  

- Prefer brand + model when model is locked  
- No purchase chatter (`I bought`, price, date, refund)  

## Gate 3 — Provider

Local diagnosis environment did not have a usable `SERPAPI_API_KEY` value (Vercel pull returned empty string).  

Production `POST /v1/target-price-check` for this product returned **POLICY_STALE** (policy freshness gate) before a matching decision — not used as matching proof.  

Unit tests simulate live-style offers (Target URL without structured model/UPC).

## Failed rule before repair

Target seller + title, **no** TCIN/model/UPC on offer →  
`insufficient_identity_for_locked_fingerprint`  
even when a **matching Target product URL** was available (URL not considered).

User message was generic: *Nobu could not confirm the exact product.*

## Repair made (fail-closed preserved)

1. **Monitoring match** applies same strong hierarchy as enrollment: **exact Target URL**, then TCIN (Target URL only), then model (incl. safe title token), then UPC.  
2. **Query builder** prefers `brand + model + Target` when model is locked.  
3. **Specific UI reasons** for insufficient evidence / model mismatch / no Target.  
4. Title-only still fails; non-Target still fails; Google `product_id` never treated as TCIN.

## Matching rules confirmed unchanged

- Seller must be Target (not Target Plus)  
- Title-only cannot pass  
- Explicit TCIN/model/UPC mismatches still fail  
- No threshold lowering; no invented identifiers  

## Live result after repair (deterministic)

| Scenario | Result |
|---|---|
| Target + exact locked URL | **match** (`exact_target_url`) |
| Target + TCIN from Target URL | **match** (`tcin`) |
| Google link + product_id only | **fail** (insufficient identity) |
| Model mismatch | **fail** |
| Title-only | **fail** |

## Provider calls consumed

**0** in CI/local (no usable key). Production one-shot check hit policy freshness only.

## Artifacts

- `diagnosis.json` — full gate output  
- `run-diagnosis.mjs` — reproducible harness  

## Lane 8

Unchanged: **NOBU_LANE_8_PENDING_REVIEW** (ASP #5541).
