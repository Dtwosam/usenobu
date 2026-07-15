# Find-Product Navigation Repair

**Date:** 2026-07-15  
**Verdict:** `NOBU_FIND_PRODUCT_NAVIGATION_PASS`

## Proven root cause

**`SESSION_COOKIE_LOST`** (with multi-instance fallout)

### Evidence

1. Redirect target was often a **valid** path:
   `/purchases/pur_<id>/review?title=…&source=LIVE`
2. Route exists: `app/purchases/[id]/review/page.tsx`
3. Pre-fix: often **no** `Set-Cookie` / empty session cookie → review on another instance called `notFound()` → blank Next.js **404**
4. After enforcing persist: failure mode became `error=save_failed&status=cookie_too_large` when the session payload exceeded the browser cookie budget
5. Live SerpApi discovery and matching were **not** the navigation defect

### Broken vs correct

| | URL / behavior |
|---|---|
| Broken | Redirect to `/purchases/pur_…/review` **without** a durable session cookie → cold instance **404** |
| Correct | Persist compressed session cookie → `/purchases/pur_<id>/review` loads purchase + live candidate |

## Repair

1. Validate purchase id (`pur_[hex]`) before redirect; never redirect with empty/wrong ids  
2. Require successful session cookie write before redirect  
3. Compress session snapshot (`deflate` + `z.` prefix) so purchase + discovery fit under ~4KB  
4. Never mid-truncate JSON (invalid evaluation crashed review)  
5. Empty live candidates → stay on form: *Nobu could not find a reliable Target product right now.*  
6. Persist failure → stay on form: *Nobu could not save this purchase. Please try again.*  
7. Missing purchase on review → redirect to form with `session_lost` (not bare 404)

No changes to SerpApi matching thresholds, policy, monitoring logic, `/v1/agent`, or ASP `5541`.

## Production proof (`https://usenobu.vercel.app`)

| Check | Result |
|---|---|
| Find my product | **No 404** |
| Redirect | `/purchases/pur_a132ea83617f/review?title=Apple+AirTag&source=LIVE` |
| Cookie | `nobu_demo_state_v1` len **1368** (compressed) |
| Candidate | LIVE Apple AirTag, confirmable |
| Fixture banner | absent |
| Confirm → monitoring | pass |
| Refresh | monitoring retained, no 404, no fixture |

Files: `production-proof.json`, screenshots `01`–`04`, diagnostics `reproduce.json`, `cookie-isolation.json`.

## Tests

- Navigation unit tests (id/path/errors)  
- `npm test` (241)  
- `npm run typecheck`  
- `npm run build`  
- Production browser proof  
- `/health` ok  
- `POST /v1/agent` frozen 404  
