# Billing filter navigation regression

Base: `07788c2da79e1717ebeffba77738030eaf54df52` (2026-10-11).

The billing ledger's uncontrolled inputs retained edited values across Next client
navigations even after the server supplied a different query. Keying the filter
form by its committed query URL remounts those controls with the corresponding
defaults. Native GET submission, billing reads, authorization and result rendering
are unchanged.

## Browser regression

Run `node scripts/internal-ui/billing-filter-navigation.mjs` with Playwright
available. `PLAYWRIGHT_MODULE` can point to an existing Playwright installation;
`CHROMIUM_EXECUTABLE` can select an installed Chromium executable. No new dependency
or credential configuration is required.

The runner copies the actual billing page, ledger and CSS into a temporary Next
app. Its billing read returns only synthetic empty data; locale is Arabic. It uses
real native GET submission, React DOM and Next Link/history navigation. The browser
blocks non-fixture network requests; the server receives an environment allowlist
without application credentials. This is local UI evidence, not authenticated
production acceptance or authorization testing.

All five scenarios failed before the source fix and passed afterward:

- Blank company, Apply Test, then Arabic New Search; confirms client navigation.
- Company/environment/date filters reset together, and Apply remains reusable.
- Back/Forward restore committed queries after unsaved edits.
- A different client-side query replaces stale draft values.
- A held navigation response released after New Search cannot restore old filters.

## Verification

- Browser regressions: 5 passed.
- Focused billing admin unit tests: 41 passed.
- Aggregate Vitest: 1,795 passed, 42 existing opt-in skips.
- TypeScript and production build: passed.
- ESLint: zero errors; seven existing warnings in unrelated files.
- Independent read-only review: no critical/important findings; fixture cleanup
  suggestion addressed and browser run repeated successfully.

Scope remains URL-changing navigation. New Search at an already query-free URL
with unsaved edits is a pre-existing same-URL limitation. Company-detail return
search preservation is deferred. Deployment and the owner's authenticated live
retest must be recorded separately from these local results.
