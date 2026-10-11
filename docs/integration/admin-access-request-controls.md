# Admin access request controls

Base: `4e7e4472abeefdcbcbae6f4f620ab7cd9c81ee25`.

The access editor previously let late account reads replace newer selections,
issued duplicate requests before React rendered pending state, and allowed rejected
transport promises to escape without feedback.

Each request now owns an identity checked before updating the view or clearing
pending state. Different account reads can supersede each other; repeated reads
of the pending account are ignored. Switching accounts immediately hides the old
editor. Confirmed writes and their follow-up reads share one pending operation,
blocking repeated submissions and account/company/scope changes until it ends.
Unmount invalidates pending work. Rejected promises use existing localized failure
messages without exposing exception details. Successful writes retain their saved
notice even when the subsequent read fails.

Server actions, authorization, tenant checks, confirmation flow, expected revisions,
grant capabilities and mutation argument shapes remain unchanged. A returned snapshot
whose user ID does not match the requested account is rejected by the view.

## Evidence

`src/components/app/admin-access-controls.test.tsx` is an independent cloud
reproduction using the repository's hook-driver test pattern and mocked action
boundaries. The original desktop archive could not be downloaded through the
supported Library flow, including the bounded retry; its bytes/hash and original
eight assertions have not been verified here.

- Initial regressions: 13 failed on the unchanged component, plus four unhandled
  rejected promises. All 13 passed after the fix.
- Final coverage: 19 tests, adding stale rejection, mismatched user ID, write-refresh
  locking/failure and late write completion after unmount.
- Focused UI/access suite: 45 passed across three files.
- Aggregate: 1,814 passed, 42 existing opt-in skips.
- TypeScript and production build passed.
- Full ESLint: zero errors, seven existing unrelated warnings.
- Independent read-only review: no critical/important findings; reviewer separately
  ran all 19 new tests successfully. The hook driver does not verify real browser
  disabled-control behavior or React scheduling.

These are local mocked regressions, not production-proven authorization breaches
or authenticated live acceptance. No real role writes, SQL, provider calls or
production interactions were performed. This change is held for coordinator release
reconciliation; it must not be treated as pushed or deployed by these local results.
