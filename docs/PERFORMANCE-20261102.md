# Velora performance investigation — 2026-11-02

Owner authorized diagnosis, scoped implementation, commit/push/deploy and authenticated verification. No provider call, customer message, payment, subscription, or destructive data action is authorized by the performance tests.

## Baseline and scope

- Canonical main and production both e26642f0912e37abe4821b0066cdf6d22617ef5e. Vercel dpl_6p43gJ6j1HRdWdKe7wXeuxYCxFoh READY, canonical aliases verified. Deployment metadata says syd1; runtime log region field says bom1. Do not assume that field proves the physical function location.
- Graphify index 6779f79 at 2026-11-01T06:50:44Z is stale. Used only to locate inbox files, followed by exact current source reads and Brain C19 references. Existing auth/OCR/knowledge/trial work remains outside this package.
- Actual production browser /app/conversations: channel filter change (WhatsApp back to All) took 3234 ms from tool click start to observed URL completion. Includes automation overhead; not INP or p95. Earlier first filter was still unchanged after 1195 ms; completion observed only later, so no precise duration assigned.
- Existing local development server log: readServiceInbox 18597 ms and 47919 ms, refreshWhatsappInboxInitialPage 20296 ms. These are separate uncontrolled samples, not production percentiles.
- Production auth trace at 04:18:25Z: profile/session phase 19381 ms total, access phase began at 7570 ms; separate broker status 306/762 ms. Prior 04:08:40Z capability probe hit PostgreSQL 57014 and correctly failed closed.
- Hosted broker capability probe EXPLAIN sample 2742.796 ms. A later JIT-off sample 37.927 ms did NOT establish JIT causality. Paired on/off/on/off repeated samples in one transaction: on 61.02/8.87/6.39, off 5.72/5.56/6.56, on 5.41/5.46/5.31, off 5.38/5.27/5.16 ms, all ok=true. Transaction rolled back. No database setting or schema change retained.

## Confirmed navigation fix

The server conversations page does not consume the selection/filter parameters. UnifiedInbox nevertheless used router.push for each selection/filter, rerunning the complete server inbox projection. Native history updates now synchronize useSearchParams and browser Back without that route request. Thread loaders retain their independent server authorization; explicit refresh and periodic scope checks remain unchanged. No new data cache, auth bypass, or provider operation.

Local same-account authenticated UI: filter selected and URL synchronized; Back restored All. Click-to-URL tool observations 677 and 1508 ms include automation overhead. No GET /app/conversations in the captured development log interval after line 2349. Production before and local after are NOT a controlled final comparison.

Regression: failed first on the old router behavior, then 37 affected tests passed across unified inbox safety, inbox paging, failure presentation and failure refresh. Scoped ESLint and secret signature scan passed. Commit 4e9f89e247950b63210df8befd449ca9f37295d1 passed CI 41388663997 (all eight jobs), and production deployment dpl_9k4wgyE4dWX9vq1GRodXqauRfLps is READY on that SHA. Full local build and subsequent typecheck also passed, but that local tree includes other agents' unpublished work.

**Hosted acceptance found a remaining defect:** after reload, a native-history WhatsApp filter click changed the URL to `?channel=whatsapp` but the DOM still showed All pressed and the previous thread while background reads were pending. The 1509ms click-return sample is therefore NOT a successful filter latency. URL completion alone was an insufficient acceptance signal. The regression now holds Next's search-parameter snapshot stale, and failed against the released code. The follow-up uses immediate local selection with URL/popstate synchronization; 37 affected tests pass locally. Browser acceptance and follow-up publication remain pending.

## Shared architecture investigation

Follow-up view-state release: `7eba4f08053788b3da53665ff63ab790474e3210`, CI41389632534 all8SUCCESS, production `dpl_JCZe3WVoCvuKrvFi5hAv4TfxDoi2` READY exactSHA. A real React/jsdom test covers immediate selection, a delayed older route snapshot and history events. Hosted acceptance remains pending: CUA lost its debugger attachment and native capture also timed out. Other agents subsequently committed c832977; do not attribute their conversation changes to this package.

Read instrumentation now distinguishes aggregate wall time, client construction, actual broker resolution and authenticated HTTP calls, with no arguments/data/identity in logs. Local diagnostic samples BEFORE in-flight coalescing: service_inbox31291ms with24 broker resolutions; another27104ms with24 broker resolutions and74 authenticated HTTP calls. Rendering samples used1 broker resolution and27–29 HTTP calls. A176ms/161ms development sample may benefit from dev fetch caching and is NOT a production speed claim. React.cache only memoizes within the React component request context; Server Action callers lack that guarantee. Workspace sample5285ms with4 regular broker resolutions (explicit fresh fences were not included in that initial counter).

The next implementation coalesces only simultaneous resolutions with identical cookie snapshots inside one explicitly scoped read operation. The entry is deleted on completion/failure, sequential checks resolve again, changed cookies use a different key, other operations use separate maps, and `fresh:true` bypasses coalescing. This is not a TTL or an authorization cache. Native capability/session/RLS checks and final scope checks stay in place. Tests cover same-flight reuse, later outage, cookie change, independent requests and explicit fresh fences.

Local diagnostic package tests:18PASS; scoped lint PASS. Existing server-availability tests have3 failures from concurrent unpublished session-actions.ts adding `confirmed` to its return value; the direct createClient outage test passes. Those unrelated auth files/tests are not included. Exact candidate CI remains required.

e3b1b4e exact candidate subsequently passed CI41390340053 all8 jobs; production dpl_7jCdoojfUq5NWrFSCe78LAmYYHZb READY. Actual production action samples show16 broker resolutions for24 client requests and66 authenticated HTTP calls: wall17908/5836/3906/2153/2752ms. Production server render samples865/894ms,1broker/27HTTP. These are a small uncontrolled sample, not percentiles, and must not be compared as a speed ratio to local31s samples. They prove considerable repeated work remains after safe concurrent coalescing.

Browser access recovered via a fresh task-owned tab after the owner reconnected Chrome. Production e3b1b4e: WhatsApp filter click showed pressed state correctly (926ms including click+AX observation); WhatsApp→All measured89ms click-to-URL with correct All pressed; Back restored WhatsApp. Prior baseline3234ms used the same account/control but different background load, so this is directional single-sample evidence, not an INP/percentage claim.

Next data-loading change: AppLayout supplies its existing authorized workspace display snapshot to WorkspaceShell, removing the second getWorkspaceView action that used to block every mounted page. Native page/data/mutation checks remain; account/company/role mismatch hides the shell. Components outside this layout retain the original guarded fallback. Local authenticated inbox visibly renders company/sidebar/content; real React tests prove no second read and account/company isolation. Embedded Instagram no longer fetches its hidden list (UnifiedInbox owns it); selected threads still authorize independently, tested with FORBIDDEN.37 affected tests pass. New package not yet published or accepted on production.

The active checklist and engineering decisions live in Brain `03-CUSTOMER.md`, PERF-SYSTEM-20261102. This file is evidence, not a parallel plan.

- WorkspaceChrome calls getWorkspaceView on each mount and withholds children until the result. The app already has an AccountSessionProvider. Measure before changing lifetime; do not share mutable identity across accounts.
- readServiceInbox and thread/page readers are called as Server Actions. React explicitly recommends other data-fetching mechanisms; frameworks typically serialize client Server Functions. Existing `/api/setup/read` already implements the correct private read transport precedent. Preserve authoritative native readers and mutations; migrate incrementally with boundary and response fences.
- Hidden Instagram pane loads its own inbox despite the parent already loading it. Keep drafts mounted but distinguish active subscriptions/reads from component lifetime.
- Auth/client construction repeatedly invokes capability checks. Historical database means are not current per-journey measurements. No cross-request authorization cache or JIT change is justified by the current evidence.

Primary research consulted 2026-11-02: [React Server Functions](https://react.dev/reference/rsc/use-server), [Next authentication DAL](https://nextjs.org/docs/app/guides/authentication), [Linear delta sync](https://linear.app/now/rebuilding-delta-sync-read-path), [Slack realtime](https://slack.engineering/real-time-messaging/), [TanStack Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults). Applicable principles are independent reads, stable scoped UI state, explicit invalidation, permission-filtered recovery and selective subscriptions. They do not justify copying a large-scale infrastructure or moving customer data.

## Remaining acceptance

- [ ] Exact production after measurement and CI/deployment SHA.
- [ ] Initial load/root authentication and duplicate reads; server action queue effects.
- [ ] Setup, settings, knowledge and dashboard controlled production measurements.
- [ ] Mobile/slow-network, LCP/INP/CLS, long tasks and React profile.
- [ ] Actual save, disconnect/recovery and incoming message acceptance within authorized side-effect scope.

Sources: installed Next 16.4.2 native History API guide; https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api ; https://github.com/vercel/next.js/discussions/49540 . Stack Overflow search was exploratory only; implementation follows official documentation. PostgreSQL catalogue reference: https://www.postgresql.org/docs/17/catalog-pg-attribute.html .
