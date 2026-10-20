# Paid setup UI integration checklist

Source-checked 2026-10-20. Stage 4 presentation handoff only. B3 actions remain unreleased; this document does not authorize mounting, backend changes, activation, provider calls, publication, or Stage 5 work. Independent QA and authoritative integration acceptance remain separate from leaf fixture results.

## Ownership and integration order

- UI owns the released leaf TSX/CSS/tests listed below, channel guide/read adapter, and the pure `branch-hours-contracts.ts`/test pair. Keep these stable unless a confirmed review fix is assigned.
- Backend coordinator/Cursor owns B3 contracts/actions/stores/migrations, shared backend changes, and central Brain files. Parent assigns any future shared `setup-wizard.tsx` or integration-host edits explicitly. Global styles, fonts, homepage and existing provider components are not released to this task.
- Release and verify B3 first. Then connect each approved leaf to its released authoritative contract, following entitled channels → hours → knowledge → language → assistant test → optional invitations → explicit launch.
- Keep a single authoritative setup read and host request lifecycle. The leaf projections below are existing presentation inputs, **not new persistence schemas**. Import their exported props/types; do not copy them into a second backend state model.
- Do not create a replacement integrated runtime/browser. The retained environment's recovery is coordinator-owned. Isolated synthetic receipts do not replace real app → ServerAction → database verification.

## Stable step and resource identities

The existing [`paidChecklistFromRead`](../../src/components/app/paid-assistant-checklist.tsx) translates IDs only:

| B1 `PaidSetupStepId` | Checklist ID | Component export / source |
| --- | --- | --- |
| `connect_whatsapp` | `whatsapp` | `PaidChannelView`, `paid-channel-view.tsx` |
| `connect_instagram` | `instagram` | `PaidChannelView`, same file |
| `hours` | `hours` | `PaidBranchHours`, `paid-branch-hours.tsx` |
| `knowledge` | `knowledge` | `PaidBranchKnowledge`, `paid-branch-knowledge.tsx` |
| `language` | `language` | `PaidReplyLanguage`, `paid-reply-language.tsx` |
| `assistant_test` | `test` | `PaidAssistantTrial`, `paid-assistant-trial.tsx` |
| `invitations` | `team` | `PaidTeamInvitations`, `paid-team-invitations.tsx` |
| `launch` | `launch` | `PaidLaunchSummary`, `paid-launch-summary.tsx` |

All component paths above are under `src/components/app/`. Preserve backend `actionId`, branch/source/page/request/operation IDs and revisions; never derive them from labels or array positions. React `useId()` values are accessibility IDs, not persisted identifiers.

Common leaf identity is `{expectedAccountId, companyId, branchId}` plus a separate `boundaryFingerprint`, matching snapshot/state versions, `locale: "ar" | "en"` and `isCurrent()`. The channel view instead nests `boundaryFingerprint` inside its `scope`. Identity inputs detect stale UI; the backend independently authenticates and authorizes every operation.

## Checklist and channel connection

- [`PaidSetupFlow`](../../src/components/app/paid-assistant-checklist.tsx), `PaidSetupFlowProps`: captured account/company/boundary, `isCurrent`, `readEntry({expectedAccountId,companyId}) → PaidBranchSetupEntryRead`, `readBranch({expectedAccountId,companyId,branchId}) → PaidBranchSetupRead`. Entry starts without a selected branch.
- `PaidAssistantChecklist`, `PaidAssistantChecklistProps`: consumes `PaidChecklistModel` through the existing adapter; `onBranchChange(id)`, `onOpenStep(branchId,stepId,actionId)`, `availableStepIds`, `onReviewLaunch(branchId)`, `onRetry()`. `onReviewLaunch` only opens confirmation. Counts, dependencies, skipped status and launch eligibility come from B1. Only team may be skipped. Do not expose fixture inspection/render props in the integrated flow.
- [`PaidChannelView`](../../src/components/app/paid-channel-view.tsx), `PaidChannelViewProps`: `scope`, authoritative B1 `read`, selected `channel`, optional B3 `connectionRead`. It has **no provider mutation callback** today. Releasing B3 does not silently make this leaf connected.
- [`WhatsappConnectionGuide`](../../src/components/app/whatsapp-connection-guide.tsx), `WhatsappConnectionGuideProps`: `route: "new-number" | "coexistence"`, locale, backend-owned `connectionStatus`, optional `connectEnabled`, `connecting`, `onConnect()`. Guide navigation is not connection proof. Source 13's QR image remains withheld.
- [`scopedChannelConnection` / `channelConnectionLabel`](../../src/components/app/paid-channel-connection-model.ts) read flat B3 account/company/branch/channel identity and preserve negative capabilities. Connected but unverified displays pending. `reconciliation_required`, `legacy_ambiguous`, `unavailable` do not advance setup.
- **Mounting dependency:** release exact B3 bytes and approved binding for read/start/complete/recover/cancel. Flow IDs are `wa_new_number`, `wa_coexistence`, `instagram_direct`. Consume only the matching successful start's launch material, keep it transient, then reread B3 and B1 after complete/recover. Coexistence needs inbound and outbound proof. No auto-adoption of company-only links or Facebook-alternative promise.

## Leaf input/callback index

Below, “context” means the existing leaf's flat scope fields plus `expectedVersion`, except hours, whose draft explicitly nests `scope`. Callback return type is `void | Promise<void>` unless stated. Resolution alone is never a save, invitation, test, readiness or launch receipt.

| Exported props / snapshot | Supplied data and exact callbacks | Authoritative capability required |
| --- | --- | --- |
| [`PaidBranchHoursProps`](../../src/components/app/paid-branch-hours.tsx), `BranchHoursSnapshot` | Stored timezone/schedule/version; `copyTargets`. `onSave(BranchHoursSaveDraft)`, `onCopy(BranchHoursCopyDraft)`, `onReload(scope): void`. Save draft: `{scope,expectedVersion,schedule}`. Copy: `{source,mode:"local-weekday-clock",targets:[{branchId,expectedVersion}]}`. | Branch-scoped persistence/revision checks, authorized targets and confirmed readback. Existing company `hours` text is not this schedule. |
| [`PaidBranchKnowledgeProps`](../../src/components/app/paid-branch-knowledge.tsx), `BranchKnowledgeViewSnapshot` | Host quota, bound sources, pages and capabilities. `onAddWebsite(context + {url,rightsAttested:true})`; `onUploadFiles(context + {files:File[]})`; `onSaveText(context + {title,content})`; `onPageAction(context + {pageId,pageVersion,action:"retry"\|"retrain"})`. | Branch binding; atomic 10/50 page quota/accounting; page identity/version and retry/retrain capabilities; persistence, extraction, approval/readiness. Unknown quota locks mutations. |
| [`PaidReplyLanguageProps`](../../src/components/app/paid-reply-language.tsx), `ReplyLanguageSnapshot` | Existing `CompanyRecord["reply_language"]`, confirmation and `canConfirm`. `onConfirm(context + {replyLanguage})`; the leaf explicitly requests `"both"`. | Authorized company language update plus separate branch-step confirmation/readback. Existing `"both"` value alone is not confirmation or readiness. |
| [`PaidAssistantTrialProps`](../../src/components/app/paid-assistant-trial.tsx), `TrialSnapshot`, `TrialMessage` | Sector, knowledge revision, scoped messages using existing `AnswerResult`. `onAsk(context + {knowledgeRevision,question})`; `onRetry(context + {knowledgeRevision,requestId})`. | Paid branch trial authorization, budget/idempotency, approved-source revisions, request reconciliation and scoped result provenance. Retry requires `failure.retrySafe === true`, `canRetry === true`, and matching nonempty `failure.requestId === state.requestId`. |
| [`PaidTeamInvitationsProps`](../../src/components/app/paid-team-invitations.tsx), `BranchTeamSnapshot` | Authoritative available seats/limit 2 or 4, staff role permission, scoped invitations, skip status, separate create/skip operation UUIDs. `onInvite(context + {operationId,name,email,role:"staff"})`; `onSkip(context + {operationId})`; `onRetry(context + {operationId,operation:"invite"\|"skip"})`. | Branch membership/invitation binding, atomic seat reservations excluding owner, server-minted operation intent and safe retry, explicit optional-skip persistence. No email is sent by this leaf. |
| [`PaidLaunchSummaryProps`](../../src/components/app/paid-launch-summary.tsx), `LaunchSummarySnapshot` | B1 launch/channel/entitlement projection; readiness revision/blockers; supplied channel/hours/knowledge/persona/team summaries; activation receipt and operation UUID. `onLaunch(context + {readinessRevision,operationId,confirmed:true})`; `onRefresh(context + {operationId:string\|null})`. | Atomic final readiness/paid-entitlement/security gate, explicit confirmation, idempotent activation and durable reconciliation. `onRefresh` is read-only. Success copy requires a matching operation receipt and confirmed B1 state. |

Use existing helpers rather than recreating validation: `prepareBranchHoursSave`, `prepareBranchHoursCopy`, `validateBranchHours`; `knowledgePreparationFileError` and existing knowledge batch/extraction rules; `trialSuggestions` and `ANSWER_MAX_QUESTION_CHARS`; `validTeamRecipient`, `knownTeamSeats`; `hostAllowsLaunch`. They are UI guards, not server authorization.

## State and asynchronous behavior

| Leaf | Exact host `phase` values | Integration consequence |
| --- | --- | --- |
| Hours | `loading`, `ready`, `saving`, `saved`, `conflict`, `unavailable` | Conflict locks edits until readback. Callback rejection displays failure but has no durable UNKNOWN model. Host must lock unresolved writes. |
| Knowledge | `loading`, `ready`, `busy`, `saved`, `conflict`, `unavailable` | Per-page status is existing `draft/stored/processing/ready/failed` or unknown. Prepared is distinct from approved for answers. Ambiguous writes need host-controlled busy/unavailable and reconciliation. |
| Language | `loading`, `ready`, `saving`, `error`, `conflict`, `unavailable` | Separate `confirmation: confirmed/unconfirmed/unknown`. Unknown confirmation disables action. No explicit request UNKNOWN phase; host must not return ready on ambiguous persistence. |
| Trial | `loading`, `ready`, `pending`, `error`, `unknown`, `unavailable` | Rejected dispatch locally blocks new asks. Safe retry is bound to the failure's request ID. Host supplies messages; no local answer or completion is fabricated. |
| Invitations | same as trial | Local mutation remains latched after resolution until authoritative phase/version/capture/operation update. Retry requires UUID, operation kind and explicit `canRetry/retrySafe`. Skip never means invitation sent. |
| Launch | same as trial | Local launch remains latched after resolution. UNKNOWN permits status reconciliation, never fresh activation. Read refresh does not itself clear local uncertainty. |

Host lifecycle checklist:

- [ ] Capture account/company/branch, boundary, resource revision and request/operation identity before dispatch. Set host pending synchronously; reject duplicate intents server-side.
- [ ] Recheck capture after every await and before projecting data. Abort/invalidate old reads on scope change. Never relabel an old result with the currently selected branch.
- [ ] Use each exported view-key helper's existing reset semantics. Hours/knowledge/language reset by scope/capture/version; trial also by knowledge revision; invitations by operation UUIDs and phase; launch by readiness revision/operation UUID and phase. Locale changes preserve drafts.
- [ ] Increment authoritative revisions or invalidate the capture when underlying data/authority changes. A cosmetic rerender is not reconciliation. Do not use phase changes to re-enable an unresolved operation.
- [ ] Map released backend outcomes into these existing props in one host adapter. Do not add another independently editable completion/progress store.
- [ ] Refresh B1 only after authoritative mutations; optional skip and launch need their own durable outcomes. No fixture status, local checkbox, fulfilled Promise or saved company language may mint readiness.

## Compatibility gaps to resolve before mounting

1. B1 supplies `asOf`, not the newer leaf numeric versions/readiness revisions. Define authoritative resource revision mappings; do not use timestamps or a local counter as optimistic concurrency proof. Knowledge currently accepts revision 0; language/trial/team/launch require positive integers. Confirm the backend range rather than coercing it.
2. Hours' explicit overnight/week schedule and copy semantics have no assumed persistence in legacy `company.hours`. Copy preserves each target's stored timezone and local clock; it does not convert zones.
3. Legacy knowledge records are company-scoped. Null/unassigned branch sources remain hidden. Website collection currently handles a URL document, not authoritative crawling/quota accounting. Only PDF text, TXT and DOCX are extraction-supported; FAQ reuses text-source title/content. File extraction, page retraining and approval are separate operations.
4. Language remains a company-wide setting; the UI explains this. The existing whole-profile `saveOwnerBusiness` action is not a narrow branch confirmation contract. Automatic runtime language detection is unverified in inspected answer paths.
5. Existing `AssistantTester` directly calls company-only `askCompanyAnswer({question,locale})` and billing reads. Do not mount it as the new paid branch tester. The new leaf needs real branch/knowledge/request provenance and durable uncertain-attempt handling; synthetic examples are labelled and never readiness evidence.
6. Existing invitation APIs save company-wide staff links; they do not establish per-branch seats or email delivery. Preserve original operation IDs/payload on retry. Host-confirmed link sharing/delivery remains a separate missing integration surface; this leaf exposes no token or link-copy control.
7. B1 `launch.canRequest` alone lacks a readiness revision and activation receipt. Legacy company review/subscription clock state is not paid branch activation. The final backend gate must independently revalidate all requirements and prevent replies before confirmed launch.
8. UI scope aliases are structurally similar but intentionally local. Keep actual exported shapes; no cross-file type consolidation is authorized during integration preparation. Required mappings above belong in the assigned host adapter.

## Evidence and release checkpoints

Exact hashes, commands, screenshots and limitations are in `C:/Users/DELL/Documents/Codex/2026-10-20/task/`:

| Area | Latest handoff | Recorded leaf unit/browser checks |
| --- | --- | --- |
| Channel guide/view | `paid-channel-leaf-handoff.json` | 35 / 162; read-adapter follow-up in `hours-channel-ui-handoff.json` |
| Hours review fix | `hours-review-fix-handoff.json` | 30 / 194 |
| Knowledge direction/populated-source fix | `knowledge-review-handoff.json` | 23 / 194 |
| Language | `reply-language-handoff.json` | 21 / 258 |
| Trial request-ID review fix | `assistant-trial-review-handoff.json` | 34 / 290 |
| Invitations | `team-invitations-handoff.json` | 26 / 282 |
| Launch | `launch-summary-handoff.json` | 25 / 338 |

These counts describe their recorded bytes, not a fresh combined run or all-stage acceptance. The latest review-fix receipts supersede earlier leaf hashes. Consult parent QA status before editing or mounting; an implementation handoff is not automatic QA release.

- [ ] Compare current hashes with each applicable handoff and obtain exact ownership/backend release.
- [ ] Verify the authorized recovered integrated environment, actual authentication/tenant boundaries and server-side permissions.
- [ ] Exercise real app → ServerAction → database outcomes, stale account/branch/revision, duplicate intents, UNKNOWN reconciliation and reread consistency without provider calls where possible.
- [ ] Verify RTL/LTR at 320/390/768/1440, keyboard focus, reduced motion, selected-channel filtering and approved original persona assets in the integrated host.
- [ ] Separately authorize and verify actual provider/AI/channel delivery and final launch; preserve no-customer-replies gate. No production readiness, publication or Stage 5 advance follows from this checklist.
