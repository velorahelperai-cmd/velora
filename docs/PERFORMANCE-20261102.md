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

Regression: failed first on the old router behavior, then 37 affected tests passed across unified inbox safety, inbox paging, failure presentation and failure refresh. Scoped ESLint and secret signature scan passed. Build and exact-release CI/deployment/production acceptance pending.

## Remaining acceptance

- [ ] Exact production after measurement and CI/deployment SHA.
- [ ] Initial load/root authentication and duplicate reads; server action queue effects.
- [ ] Setup, settings, knowledge and dashboard controlled production measurements.
- [ ] Mobile/slow-network, LCP/INP/CLS, long tasks and React profile.
- [ ] Actual save, disconnect/recovery and incoming message acceptance within authorized side-effect scope.

Sources: installed Next 16.4.2 native History API guide; https://nextjs.org/docs/app/getting-started/linking-and-navigating#native-history-api ; https://github.com/vercel/next.js/discussions/49540 . Stack Overflow search was exploratory only; implementation follows official documentation. PostgreSQL catalogue reference: https://www.postgresql.org/docs/17/catalog-pg-attribute.html .
