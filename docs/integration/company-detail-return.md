# Company detail return context

Base: `3b7c9d0777bca67dbaa81d0805a96ba9ca5f6f72`.

Company list links now carry the applied search and selected status in an encoded
return destination. Returning from detail hydrates those filters and automatically
reloads the matching company list; the server keys the view by that filter context.
Unsubmitted search drafts do not replace the applied search. Billing-origin company
links also retain their existing filters and browse cursor.

Return destinations are restricted to `/admin` with company-search/status parameters
and the companies section, or `/admin/billing` with existing billing parameters.
Other paths, external destinations, traversal, duplicate parameters and unknown
parameters fall back to `/admin#companies`. Validation runs at both the detail route
and the rendered link. Return context is not used for authorization; all existing
server gates and query rules remain unchanged.

## Verification

- Initial three component/page regressions failed before implementation and passed
  after it. Final focused suite: 55 passed (including existing count/auth tests).
- New coverage includes Unicode/query encoding, hostile destinations, duplicate
  values, actual detail/billing links, automatic query reload and route authorization.
- Aggregate: 1,854 passed, 42 existing opt-in skips.
- TypeScript and production build passed; full lint has zero errors and the same
  seven existing unrelated warnings.
- Existing isolated Next/Chromium billing browser suite: all five cases passed.
- Additional isolated Next/Chromium company smoke passed: actual company list,
  detail and return route components restore search/status/results; reload retains
  them. Only synthetic local read adapters were used. Local runner/evidence:
  `/tmp/velora-company-return-browser.mjs`, `/tmp/velora-company-browser.log`.
- Independent read-only review found no critical/important issues. Its suggested
  browser smoke was completed before committing.

These are local results, not authenticated production acceptance. No SQL, real
provider calls, role changes, credentials or access permissions were changed.
Existing commits `4e7e447` and `3b7c9d0` remain unchanged; the new genuine work uses
the owner's verified repository-local project identity prospectively. Deployment
status and the parent's authenticated live retest must be recorded separately.
