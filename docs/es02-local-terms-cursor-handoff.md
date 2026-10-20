# ES02 local terms — Cursor handoff

Status: **Codex verified the terms candidate; comment-only follow-up released**. Path: `C:\Users\DELL\Desktop\Velora new`. Cursor did not run the tests.

## Codex verification

Codex ran and verified the local terms candidate:

- 8/8 Vitest, 3 suites
- TypeScript 0
- lint 0
- 58/58 Chrome, Arabic and English, desktop 1600 and 320
- financialPosts 0, pageErrors 0

Passing behavior: both removed banner phrases absent in Arabic and English; 18 clauses; 7 open decisions; language toggle after hydration; clause 18 link; opening terms and returning with consent off; `data-plans-back`; retained business identity, data, and branch choices Dana Standard and Lina Premium; yearly total 1872000.

Evidence in `C:\Users\DELL\Documents\Codex\2026-10-16\task\`:

- `es02-terms-local-unit.log`
- `es02-terms-local-unit.json`
- `es02-terms-local-typecheck.log`
- `es02-terms-local-lint.log`
- `es02-terms-local-browser-result.json`
- `es02-terms-draft-*.png`

No effective or published state. The seven decisions stay open: operator 1/18, billing 4/5, allowances 6/7/8, remedies 6/8/14/15, data 12, liability 16/17, law and language 1/18. Primary-branch 49/62 and SQL 15 were not rerun.

## Comment-only correction

`src/lib/service-terms-draft.ts` no longer says paragraphs 1–56 are all verbatim. The comment now says the 18 Arabic contractual clauses remain verbatim, the warning labels were removed at the user's request, and paragraphs 57–98 are internal research. No data or behavior changed. `effective=false` and `acceptanceVersion=null` stay.

## Release

Writing is finished. Terms file ownership is released for Codex to confirm the comment-only diff and show the review page.

## Existing runtime sync

The comment-only data file was copied into the already running preview `C:\Users\DELL\AppData\Local\Temp\codex-es02-visible-57c63ddc-145e-4642-9aef-660e10b8de42`. No restart, reload, cookie, env, key, or input change. SHA256 matches on both sides:

| File | SHA256 |
| --- | --- |
| `src/app/terms/page.tsx` | `f1a8685d141ee080dc8a998f01cdbb8f3d2fb09ba190b4c20494c72a41939f6e` |
| `src/components/app/workspace-pages.tsx` | `d3f10570230d32481bd7deaf159dede11f6757e21b642700fe4950fc80a7b3fe` |
| `src/components/app/service-terms-draft.tsx` | `f68e4d1defe798f511136f6d31e40af787ac6efd5a0b0c09ee00995178966003` |
| `src/lib/service-terms-draft.ts` | `5c6a5112ade8cd8d77816b8882d5bb91fc4d230a40efe3937149b26ebf425151` |
