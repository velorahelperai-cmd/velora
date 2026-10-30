# Static cache and performance release — 2026-10-30

Owner explicitly authorized Commit, Push and automatic deployment for this package in this chat. Base: `94da31766050236aeb6b4f53891f0c0fb07a394c`. This includes this agent's prior local global-data review and Teams read fixes; unrelated WhatsApp/auth/deletion-tool work is excluded and preserved.

## Cache decision and evidence

- The old worker eagerly fetched 9 assets (3 images + 6 fonts), totalling **3,225,042 source bytes**, regardless of the route visited. It duplicated Next optimized image requests with original-image downloads and retained cache-first entries indefinitely. This is a source-byte/request-plan measurement, not a measured bandwidth saving for every visitor (HTTP cache/compression may apply).
- Retire that worker at its existing `/sw.js` URL: skip waiting, delete only `velora-static-v1`, claim existing clients, unregister. No fetch handler or precache. No page reload, cookie changes, draft clearing or other cache deletion. Existing installations require a successful online worker update; failure retries on another visit.
- CacheBootstrap updates only same-origin `/sw.js` registrations; new visitors do not install a worker. Thus forced asset precache requests fall **9 → 0**. Normal demand-based browser/Next/CDN caching remains.
- Hero, phone frame and chatbot avatar now use static image imports. Next emits content-hashed URLs with immutable caching, so changed content gets a new URL. No pixel/design changes or dependency additions. Existing image dimensions/loading behavior remain.
- Unhashed `/assets/*` and `/fonts/*`: browser max-age 1 hour, CDN max-age 1 day, stale-while-revalidate 1 day. Removed the incorrect blanket one-year immutable promise for mutable filenames. Hashed `/_next/static` keeps Next's immutable policy; `/sw.js` remains revalidated.
- Existing browsers can retain old immutable public URLs until their prior TTL expires. Updated imported images bypass those URLs; no claim of remote eviction of existing HTTP caches. Future urgent changes to raw public URLs should use a new filename.
- No added cache for HTML, API, private media, session authority, finance, messages, knowledge or mutations. Setup scoped read/draft fences and fresh native write authority remain unchanged. Fonts and optimized images already use browser caches, so a second application cache has no proven benefit.

Guidance: installed Next 16.4.2 image/headers docs; [Next image caching](https://nextjs.org/docs/app/api-reference/components/image#minimumcachettl), [worker unregister lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister). Graphify matched base HEAD, build `c5ab3bd6-f0cb-4a88-ab2b-870e996a2b91`; local changes reviewed directly.

## Prior changes included

[59-page coverage](GLOBAL-DATA-COVERAGE-20261030.md): parallel reads, bounded channel concurrency, account/app loading boundaries, removal of the unused preview route. [Teams evidence](TEAMS-READS-PROTECTED-MEASUREMENTS-20261030.md): remove discarded preflight and eager navigation reads; actor/session boundary fence and in-flight-only dedup.

Their earlier no-publication statements describe their preparation stages; the explicit approval above supersedes that restriction for this package only. No unrelated agent implementation is included.

## Validation and limits

- New cache/lifecycle and existing landing tests: **58/58 PASS in 8 files**. Scoped ESLint PASS. Prior team changes: 49 affected tests PASS; prior architecture checks documented in their reports.
- Release-file-only full lint PASS; final changed-file lint PASS; production build PASS; 69 security contracts PASS; dependency audit zero; Gitleaks tree zero. Full unit run: 5294 passed, 54 existing skips, 2 old Teams preflight assertions failed. Updated those assertions to the new shell contract and strengthened native-denial UI proof; final entire Teams suite 86/86 PASS. Contracts: 313 passed, 38 existing skips. No new skips, disabled rules or artificial exceptions. Full suite is not rerun for this test-only correction; hosted CI will rerun it on the final SHA.
- Final focused cache/landing suite 58/58 PASS. Snapshot inside .git caused module-resolution errors in simulated-browser tests; using an identical temporary release-file snapshot outside .git resolved them, with no test configuration change.
- Built-server HTTP smoke: all five asset/worker/optimizer requests returned 200. Hashed source image uses one-year immutable; public raw image/font use bounded cache policy; worker uses max-age=0/must-revalidate. Optimized 96px avatar served WebP (1584 bytes); compression was already supported by Next and is not claimed as a newly introduced saving.
- Final SHA, typecheck and hosted CI/deployment results are recorded in the release receipt/final response. No production success is predeclared.
- No population latency claim, no claim that this fixes protected Settings delay. Current authenticated account lacks internal team membership; live team acceptance remains unavailable. Protected local browser/mobile/RLS acceptance limitations remain as documented. Worker migration is unit-tested; actual existing-client rollout requires a successful production visit/update.
- Other changes stay in the shared worktree. The selected release manifest and preservation hashes are stored locally under `.git/image-cache-*`; no private runtime files or deletion tooling are part of the release.
