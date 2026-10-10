# Internal setup/workspace acceptance (2026-10-10)

Base: `1595c5e9d3cbb31af9c973b647b155f0d8f816b9`, Windows main worktree. This slice is local code and isolated synthetic acceptance, not customer production acceptance.

## Product changes

The wizard restored the first incomplete milestone whenever a company timestamp or knowledge count changed. An incomplete subscription therefore redirected knowledge edits back to milestone 2. Navigation now restores once per user/company scope and respects a valid scoped saved step. Completion still comes from server records, never local complete flags. Hours and reply-language edits now warn before leaving; cancellation keeps edits, and confirmed saves advance without a dirty warning. Review completion refreshes server evidence rather than marking approval locally.

Scoped CSS gives setup and the shared workspace a light neutral palette, dark emerald controls, existing locally licensed IBM Plex Arabic/English fonts, reduced motion and visible focus. Desktop milestones are compact; mobile has the current milestone and a labeled native picker. The mobile workspace uses an inline disclosure with keyboard activation and Escape focus return, retaining the real account, tenant-selection, role-filtered navigation and sign-out actions. Main content uses a minimum-zero grid column rather than page-wide clipping. Direct knowledge child panels receive matching colors and bilingual presentation; save, extraction, version and approval actions are unchanged. Dashboard text uses readable semantic colors. Unknown live activity is labeled unavailable; explicit `wa_verified_not_live` evidence still displays disabled.

Root layout, global CSS, homepage components, font assets and providers are unchanged from the base. The old unmerged UI commit `e49e8e79d69c15b2013b66c08e79ff12d53d5ce6` remains intact and was not merged.

## Reproduction and verification

The original resume resolver reproduced seven failing cases before the fix. The regression suite now covers valid navigation, malformed steps, user/company mismatch and server-owned facts.

Commands:

- `node node_modules/vitest/vitest.mjs run src/components/app src/lib/company-draft.test.ts`
- `node node_modules/vitest/vitest.mjs run`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- `node scripts/internal-ui/browser.mjs --after-only` (final visual capture; development refresh interrupted one later navigation)
- `node scripts/internal-ui/browser.mjs --interactions-only` (remaining real persistence and keyboard acceptance; retains existing viewport metrics)

The browser fixture runs actual Next components and server actions against real isolated GoTrue/PostgREST/PostgreSQL, using 72 project migrations through `20261009215520_g03_verified_review.sql`. The pending exact-generation and service-contract migrations are deliberately excluded: no file upload, service purchase or live grant is tested here. All outbound traffic is restricted to the owned loopback app/backend. Providers, billing dispatch and WhatsApp sends are disabled. Random test credentials stay in memory; screenshots contain only synthetic accounts and company information. Containers use unique identities and cleanup verifies those identities; unrelated containers are not restarted.

Preserved before/after screenshots and viewport metrics are under `artifacts/internal-ui/`. Coverage: English and Arabic setup/settings at 320, 390, 768 and 1280 pixels, plus the excluded homepage at 1280. Final pass/fail details are recorded in the local `result.json`. A first reload assertion mistakenly inspected abbreviated visual button text; it was corrected to inspect the accessible full label. The original before screenshots are retained. The homepage screenshots have identical dimensions; raw comparison found 33 differing pixels out of 16,843,520, so exact pixel equality is not claimed. Homepage source and global dependencies were verified unchanged with Git.

## Limits

No production SQL, deployment, Git push, paid model call, live payment or external customer message occurred. Existing QA A/B browser sessions were unavailable, so live acceptance remains blocked. Auth styling/password recovery and the admin drawer are separate slices. These UI checks do not prove live rollout, payment entitlement orchestration, model answer quality, file preparation on the cloud deployment or complete production readiness.

## Recorded outcome

- Reproduced resume contract: 7 failures before fix; 14 cases pass after fix.
- Focused final regression: 89 tests pass across 10 files.
- Full offline regression: 1,420 pass, 42 opt-in skip across 134 files. Final small SSR-evidence/copy adjustments were followed by focused tests, lint and a successful final build.
- TypeScript: pass. Lint: pass with the existing `src/lib/billing/paymob/reconcile.ts:344` unused `_result` warning. Final production build: pass, 34 pages generated. `git diff --check`: pass.
- Browser: complete viewport/RTL/no-page-overflow capture; scoped navigation reload; real hours/language dirty cancellation and saved advancement/reload; real knowledge create/edit persisted content version 2 and remained unapproved; keyboard mobile menu activation, Escape return focus, desktop navigation visibility. Evidence combines isolated runs with separate synthetic fixtures.
- The final keyboard-only command is `node scripts/internal-ui/browser.mjs --keyboard-only`. The previous interaction run passed all save/persistence checks but its last focus assertion used the wrong label `Knowledge`; the actual translated navigation label is `Business info`. The harness was corrected. The earlier exact native-picker label match was corrected to an accessible-name prefix match. These were harness failures, not claimed product successes.
- Fresh SSR knowledge records reconcile separately from navigation so version-bound trial state still invalidates when authoritative sources change. The optional empty source prop uses a stable default. A final copy correction labels the ratio as source coverage and does not imply an approved version exists when the count is zero.
- Test cleanup confirmed only the pre-existing `velora-c2-runtime-13861eb` container remained running. No unrelated container was restarted.

No remaining local implementation blocker. Live QA needs access to an already-authorized QA account/session; no role creation or credential reset is requested. The pending production migrations and deployment require their separately scoped authorization.
