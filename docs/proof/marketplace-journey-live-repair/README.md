# Marketplace journey live repair — WSL environment blocked

**Date:** 2026-07-27
**Starting HEAD:** `139dad3b33edcd0d07716f009a729764b6e7564e`
**Canonical application commit:** `139dad3b33edcd0d07716f009a729764b6e7564e`
**Canonical Production deployment:** `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd`
**Canonical deployment host:** `usenobu-cf3hbavti-dtwoflicks-2878s-projects.vercel.app`
**Verdict:** `NOBU_MARKETPLACE_JOURNEY_BLOCKED_WSL_LINUX_DISTRO_MISSING`

## WSL-only continuation — environment blocker

**Starting documentation HEAD:** `78daed568e576f2cefa625be31cbdf192f30ef89`
**Canonical application commit:** `139dad3b33edcd0d07716f009a729764b6e7564e`
**Canonical Production deployment:** `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd`
**Verdict:** `NOBU_MARKETPLACE_JOURNEY_BLOCKED_WSL_LINUX_DISTRO_MISSING`

The tracked worktree and index were clean before the continuation. Native Windows Onchain OS was never invoked.

Read-only Windows WSL inspection returned:

- default distribution: `docker-desktop`;
- default WSL version: `2`;
- registered distributions: exactly one, `docker-desktop`, running on WSL2;
- attempted Linux entry: `execvpe(bash) failed: No such file or directory`.

Docker Desktop’s distribution is an internal managed environment, not an initialized user Linux distribution. It was not modified or used for wallet, identity, package or daemon configuration. Installing a new Windows distribution is a separate persistent system change and was not inferred from the lane.

This is the first genuine failure. Consequently:

- Linux Node, npm and npx availability could not be established;
- official Linux Onchain OS was not installed;
- no Linux preflight or login ran;
- agent `5541` and services `33561`/`35958` were not read;
- no WSL A2A package or daemon was installed;
- no free task was created and mapped pass `pass_8dd13c79ce1842aa89f91609527764f4` was untouched;
- `agent activate` did not run;
- no payment, `402`, new pass, email, consent, redemption or monitoring action occurred.

Both quarantined passes remain unused and unchanged:

- `pass_d154602364564dd8b8b76540db54248b`
- `pass_1c299f2ee82e457eaa1da384ded38109`

Exact next step: install and initialize a supported user WSL2 distribution such as Ubuntu, complete its normal first-run Linux user setup, and then rerun the requested lane wholly inside that distribution. Do not use native Windows Onchain OS or repurpose `docker-desktop`.

## Superseding cleanup diagnosis

The continuation began at expected HEAD `5fb430b85cc9be92659058c4a4fc952a348d344f`. The index was clean; exactly the three authorized documentation files from the prior blocked continuation were modified and uncommitted. They were preserved for this closeout.

### Exact root cause

Official source tag `v4.4.0` resolves to commit `782b5a05d9b0af797383009b0e5f0d4022b010e5`. In `cli/src/commands/upgrade.rs`:

- lines 40–71 hard-code all 24 deprecated identifiers;
- lines 759–763 state removal is unconditional and assume `npx` no-ops when names are absent;
- lines 788–795 directly launch `Command::new("npx")`;
- lines 832–857 convert every spawn/non-zero/timeout result into the manual cleanup action.

This Windows Node installation exposes `C:\Program Files\nodejs\npx` and `npx.cmd`, but no native `npx.exe`. A direct-process reproduction returned `spawnSync npx ENOENT`; shell launch succeeds because PowerShell resolves its launcher. Thus preflight fails before the skills manager can inspect installed packages. The earlier shell cleanup correctly reported `No matching skills found`.

### Roots and registries inspected

| Consumer | Roots / source | Result |
|---|---|---|
| Onchain OS binary | `C:\Users\dtwof\.local\bin\onchainos.exe` | Version/current/latest `4.4.0`; integrity `ok`; drift `null` |
| Preflight monorepo detector | `.codex/onchainos-skills`, `.openclaw/onchainos-skills`, `.cursor/onchainos-skills`, `.config/opencode/onchainos-skills`, `.claude/onchainos-skills` under `C:\Users\dtwof` | No deprecated installation |
| Preflight per-skill detector | `.agents/skills`, `.claude/skills`, `.codex/skills`, `.openclaw/skills`, `.cursor/skills` | No deprecated directory |
| Supported global skills manager | `C:\Users\dtwof\.agents\skills`; lock `C:\Users\dtwof\.agents\.skill-lock.json` | Exactly eight current OKX bundles |
| Claude mirror | `C:\Users\dtwof\.claude\skills` | Current OKX entries are junctions to `.agents\skills` |
| Codex root | `C:\Users\dtwof\.codex\skills` | Unrelated Codex/system bundles; no deprecated OKX entry |
| Application-local roots | `AfterBuy\.agents\skills`, `AfterBuy\.codex\skills` | Absent |
| A2A runtime | npm global root `C:\Users\dtwof\AppData\Roaming\npm`; package `@okxweb3/a2a-node@0.1.10`; daemon PID `27124` | Package and daemon preserved |

No physical deprecated package, stale lock entry, stale official cache/index, renamed alias directory, alternate-user install or bundled resource requiring deletion was found.

### Minimal-repair decision and stop

No mutation was performed. Reinstalling the current `4.4.0` binary would reinstall the same confirmed source defect. Refreshing the skill registry cannot fix a process spawn that occurs before registry inspection. A custom native `npx.exe` shim or manual registry edit is not an official supported repair and was not introduced. Therefore no post-repair preflight exists; repeating the same known-failing command would violate the lane instruction.

The read-only A2A doctor reported package `0.1.10` and daemon PID `27124` running, but overall `ready: false` because configured provider `claude` differs from detected runtime `codex`. The auto-fix was not run because the request required preserving daemon configuration and stopping on the first genuine failure.

No free task was created. Mapped pass `pass_8dd13c79ce1842aa89f91609527764f4` was not used. ASP `#5541` and services `33561`/`35958` were not read or changed; `agent activate` did not run. No paid service, `402`, payment, new pass, purchase intake, candidate confirmation, email, consent, redemption or monitoring activation occurred. The last proven listing state remains rejected / not listed.

The quarantined passes `pass_d154602364564dd8b8b76540db54248b` and `pass_1c299f2ee82e457eaa1da384ded38109` remain unused and correlation-pending. Their historical-job correlation remains a later, independent read-only accounting task.

**Verdict:** `NOBU_MARKETPLACE_JOURNEY_BLOCKED_ONCHAINOS_4_4_0_WINDOWS_NPX_SPAWN`

## Pre-mutation proof

- Tracked worktree and index were clean at exact HEAD `139dad3`.
- `usenobu.vercel.app` resolved to READY deployment `dpl_G1pxk6qa5YySUradbSXikbjHKPEG` before mutation.
- That deployment was created by the recorded clean local CLI deployment at HEAD `139dad3`; Vercel inspect exposed no separate Git metadata field.
- The earlier code commit `0c0acf1` and intermediate deployment `dpl_GCzb3QkYkAySjd1koyBQaumiiSpU` are implementation history, not canonical closeout references.

## Authorized Production recovery

A new 256-bit random `OWNER_OPS_SECRET` was generated in memory, set as a Sensitive Production value, and cleared from memory after use. It was never printed, committed, written to a file or returned. `CRON_SECRET` and unrelated configuration were untouched.

The exact unchanged application commit `139dad3` was redeployed once as `dpl_BE7Ki6KGMEhdpSsxo4pUSYewJBAd`; `usenobu.vercel.app` was explicitly re-aliased to that deployment.

Exactly two authenticated calls were made to `POST /v1/owner/pass-settlement-reconcile`:

| Call | HTTP | ok | scanned | issued | still pending | failed | continuations backfilled |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 200 | true | 2 | 2 | 0 | 0 | 0 |
| 2 | 200 | true | 0 | 0 | 0 | 0 | 0 |

Call 1 genuinely issued:

- `pass_d154602364564dd8b8b76540db54248b`
- `pass_1c299f2ee82e457eaa1da384ded38109`

Call 2 proves zero replay issuance. No payment authorization, signature, digest or settlement reference was exposed. No payment or paid task was created.

## Failure and stop decision

The lane expected at most one pending settlement for latest job `0x15a1f239…717f`. Production contained two pending records and reconciled both. The safe reconciliation response deliberately does not expose a job-to-payment mapping, so neither returned pass can be attributed to the specified job without guessing. The latest job's individual pass/state therefore remains **unmapped**, even though both recovered records are now non-pending and each issued one pass.

This is the first acceptance failure. Per the user's stop rule:

- no Onchain OS preflight command ran in this continuation;
- no deprecated global OKX package was removed;
- no free `Nobu Purchase Setup` task was created;
- no email, consent, redemption or monitoring activation occurred;
- ASP `#5541` and its services were not read or changed;
- `agent activate` was not executed.

The last proven ASP state remains rejected / not listed. No approval is claimed.

## Repair already deployed

The actionless durable Purchase Setup implementation remains deployed and previously passed its focused happy-path, safety and reconciliation tests, typecheck, Production build and safe endpoint probes. Existing-pass input remains free and starts at `confirm_use_pass`; no marketplace response exposes Nobu's internal action enum.

No new application code or code test was run in this continuation, as required.

## Exact next step

Open a new, explicitly authorized correlation lane. Use a read-only provider-controlled identifier already tied to job `0x15a1f239…717f`—preferably its known pass continuation—to map the job to one durable payment/pass without exposing settlement material. Account for the second legitimate settlement separately. Only after that mapping is proven may the deprecated-package preflight cleanup, exactly one free smoke and conditional existing-agent resubmission resume.
