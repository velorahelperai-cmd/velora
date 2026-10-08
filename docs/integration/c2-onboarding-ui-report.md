# C2 onboarding UI integration

Scope: local integration of onboarding commit `16d7cca` onto Security → Runtime → Inbox in `integration/overnight-velora`. The original Antigravity worktree was read only. Root owns merge staging and commits.

## Contract corrections

- Resolved `knowledge-editor.tsx` and `whatsapp-settings-panel.tsx` conflicts while preserving the onboarding layout, business-instruction `usage_role` selection/reset/edit behavior, Embedded Signup, authorization expiry and current authorization evidence.
- Saved company profile, hours and reply language come from the server `CompanyRecord` or a successful scoped save response. A saved local draft cannot override newer persisted facts. Failed or wrong-company saves cannot adopt facts or advance the journey. Hours must be entered by the owner; no opening hours are invented.
- The eight-step journey keeps subscription, company facts, approved knowledge, Meta authorization and administrative review separate. Subscription is complete only from matching persisted readiness. Requesting a number never verifies it. Internal trial progress remains a local company/knowledge-bound navigation marker, is explicitly labelled local, and does not count as persisted activation.
- Removed selectable tone and after-hours settings which had no persistence path. The interface points owners to approved business instructions in Knowledge. Removed factual template contents: new knowledge templates create empty forms with category titles, so prices, opening hours, return periods and delivery policies must come from the business.
- Meta verification, authorization, inbound/outbound test evidence and rollout readiness are distinct. `needs_external_action` is not verification. Missing or expired authorization cannot report rollout eligibility. Verified links with rollout disabled retain their verified label. No inbox eligibility row is evidence of live AI activity.
- Workspace keys reset WhatsApp and subscription panels. Profile, hours, language, WhatsApp requests, review requests, knowledge creation/uploads and Test checkout carry rendered company IDs to the backend guards. Knowledge routes carry the authoritative access company ID through the actual editor props.
- Knowledge reloads and review/history reads also carry the rendered company ID. Review responses for another company are rejected locally. The old review-event RPC selected the first owned company; root owns the new scoped read-only RPC migration. History stays unavailable if that dependency is missing, with no fallback to the old function.
- Dashboard accepts the bounded initial inbox page. The visible-conversation total uses `page.total`; automation permission and awaiting-staff metrics are explicitly loaded-page counts. It does not traverse complete transcripts or fabricate global worklist/automation counts. Readiness/inbox company mismatches hide metrics and recent rows.
- Subscription comparison has no seeded capacity or feature availability. Features and quotas come from matching published catalog projections and the selected term; missing evidence is unavailable. The public catalog's production `checkout_enabled:false` is preserved. The Noura Basic 45.000 OMR reference can select matching published Test offers only; the existing backend Test flags and authorization still govern checkout. Publication does not activate production payment or live replies. Admin price summaries use actual published rows.

## Offline verification

- Added 15 C2 contract tests covering stale local/company hydration, failed and wrong-company save transitions, manual/pending Meta states, expired/missing authorization, rollout disabled, incorrect Test offer identity/price, missing catalog features/capacity, monthly/annual feature separation, bounded inbox totals and mixed workspace snapshots.
- Catalog regressions reproduced before correction: missing catalogs rendered invented quotas and available capabilities; mismatched offers were accepted for selection.
- Final focused Vitest run: **50 tests passed in 6 suites**, including C2 contracts, company drafts, review refresh, catalog contracts/actions and dashboard billing projection.
- TypeScript `--noEmit`: passed.
- Targeted ESLint for all C2 edited UI files, helper, tests and knowledge route: passed without warnings.
- Both assigned conflict files contain no merge markers. Scoped whitespace checks passed; staging is deliberately left to root.

## Verification limits and rollout dependencies

This is local application/contract evidence. No cloud SQL, migrations, provider execution, paid AI verification, live sends, real data changes, deployment, push, backup or commit was performed by C2. It does not prove staged database RLS/transactions, browser OAuth, delivery, settlement or model quality. Root must complete the full integration checks and report Local Testing and Staging gates separately.

Customer WhatsApp/AI and production payment remain separate rollouts. The current readiness/inbox contracts do not attest deployed worker activity; the UI therefore cannot claim live AI activity from subscription, approval, tests or `automation_allowed`. Future live activity requires an authoritative deployment/activity contract. Full company-wide automation/worklist totals likewise require their own server aggregate contract rather than counting a bounded page.
