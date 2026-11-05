# Unified Inbox — final-reference implementation and acceptance

Date: 2026-11-04 (Asia/Muscat). Status: **PARTIAL — local source verified; final authenticated visual acceptance pending**.

## Authority and scope

Owner supplied the written final Trengo reference and the desktop image `codex-clipboard-79ad9018-faa6-47e4-a33b-3e63c712abe8.png`. Implement inside the existing `/app/conversations` route, preserve existing functionality, and do not publish. No separate route, synthetic customer data, Backend, SQL, RLS, subscription or Meta changes.

Brain access was confirmed. Graphify build `abf7f026-ed9e-40b9-8897-81286504637e` indexes `938032a` at `2026-11-03T16:55:53.002902Z`, behind current HEAD `d9ad630ee68886ed74c1f7129d9170fadf71c95f`. Owner explicitly authorized scoped current-source verification despite the old index. Graphify file neighbors were used only as the initial dependency map.

The security repair writer confirmed no active writes to `unified-inbox.tsx` after `d9ad630`. Their separate `pdf-ocr.integration.test.ts` and `inbox-failure-presentation.test.tsx` package was left untouched. Existing shared design work was retained; this receipt does not attribute all uncommitted design changes to this continuation.

## Existing functions and paths retained

- Unified authorized WhatsApp/Instagram list: `readServiceInbox` → `fetchServiceInbox`; existing channel contract, account/workspace wrapper, actor/company and membership boundaries. UNAVAILABLE, FORBIDDEN and scope-loss paths remove cached content and native panes.
- Existing channel selection, local URL/history navigation, loaded-row search, unread/intervention/automation/resolved filters, list pagination (`refreshWhatsappInboxPage`, `loadInstagramInboxPage`), manual refresh, coalesced Realtime updates and reconnect/poll fallback.
- WhatsApp native thread/history/read receipt: `refreshWhatsappThreadPage`, `markWhatsappThreadSeen`. Existing transcript position, per-thread drafts, delivery-state labels and unresolved-send locks.
- WhatsApp takeover, resume and close: existing `controlWhatsappConversation`, revision checks, control permissions and reconciliation. Follow-up, stage, assignment and internal notes continue through existing `LeadFollowUpPanel`, `upsertConversationLeadState` and existing assignment/control handlers. Native audit pagination remains available.
- WhatsApp manual reply continues through `replyWhatsappConversation`; pending, ownership, live-row, permission, human-control and unknown-result gates retained.
- Instagram native thread/history/read receipt: `loadInstagramThreadPage`, `markInstagramThreadRead`. Assignment remains `assignInstagramConversation`. Existing save-before-send flow remains `saveInstagramReply` → `sendSavedInstagramReply`, with `loadInstagramSendReadiness`, stable intent/reservations, permission/window/binding blockers and uncertain-result handling.
- Existing AI assistance remains `ChannelAIDraft` using `readChannelAIDraft` / `prepareChannelAIDraft`, paid-trial confirmation and manual draft use. No generation or external send performed during this task.
- Existing navigation links and role-controlled shell remain. Customer information uses actual permitted phone/channel/assignment/stage/follow-up/control audit/connection data. No fabricated email, calls, VIP attribute, tags, avatars or activity events.

## Continued implementation

- Scoped white/teal surfaces and soft mint selection; white search with a line icon, focus outlines, quieter warning text and static automation indicator.
- Desktop navigation 168px, inbox up to 320px, customer companion 300px from 1360px; remaining width belongs to the thread. Existing tablet/phone details Drawer and independent scroll regions retained. Compact Instagram contact rows and panel overflow corrected.
- Restored native WhatsApp follow-up worklists (today, overdue, trial/quote) in the unified list using the existing predicates and business timezone. Search retains phone, topic, summary and loaded-message matching. These local controls do not fetch another inbox.
- Added actual loaded-conversation counters with explicit loaded-page meaning, and an assignment indicator only when assignment exists. Unmatched lead filters show a filtered-empty state, not an empty mailbox.
- Existing message/note/AI tabs and native note portal retained. Internal note surface is distinct; save still uses the original handler and never sends a reply.
- Phone thread follows `visualViewport` height/top so its fixed composer can accommodate a keyboard; listeners are removed on scope loss. The existing unified back action replaces the duplicate embedded native back button. Actual device keyboard acceptance is pending.
- Copy-phone feedback reports denied/unavailable clipboard access, confirms success only after `writeText` resolves, and keys the result to the conversation scope. No phone value is added to stored copy feedback.

## Verification

- **57 distinct tests PASS across six affected suites.** Final unchanged unified/list suites retained their passing evidence; after final native-pane changes, only the three affected presentation/composer/Instagram suites were rerun (18 PASS). No duplicate test counts.
- Suites: `unified-inbox-safety.test.tsx` (12), `unified-inbox-realtime.test.tsx` (16), `conversations-inbox.test.ts` (11), `conversation-presentation.test.tsx` (2), `conversations-composer.test.tsx` (2), `instagram-inbox.test.tsx` (14).
- Added regressions cover phone search and restored lead worklists with no extra inbox fetch; correct filtered-empty state; visible-viewport listener cleanup on scope loss; failed/successful clipboard feedback without reply/note writes. Existing tenant, revocation, UNAVAILABLE, pagination, draft, note-save and Instagram guards remain asserted.
- Project TypeScript `--noEmit --incremental false`: PASS. Scoped ESLint: PASS. Scoped Git whitespace check: PASS. Both scoped CSS files parse successfully with PostCSS.
- Design source linter: zero FAIL. Its overlay-shadow warning applies to an actual Drawer; its pulse warning matches the CSS selector that disables the existing pulse.
- No full build, full CI, hosted deployment, live sending, AI execution or database verification claimed for this design continuation.

## Runtime and screenshots

An ordinary local Next run correctly failed closed with `ENCRYPTION_KEY_MISSING` / `SERVICE_ROLE_MISSING`; it was stopped. This is missing runtime configuration, not visual acceptance evidence.

Owner identified `scripts/live-customer/start.ps1`. Existing DPAPI configuration presence was checked without opening its contents. The unchanged launcher starts successfully at `http://127.0.0.1:3330`; the real inbox redirects the fresh browser to native login. A headed Chrome session named `velora-inbox-design` is open. Credentials and configuration values are excluded from this report and source receipts.

The existing owner-local Chrome tab was also checked at `http://localhost:3330/app/conversations`, retaining the browser's native session. It returned `/access?code=UNAVAILABLE`; one native Retry did not recover. Current server evidence records `CAPABILITY_PROBE_UNAVAILABLE` / `CAPABILITY_FAIL_CLOSED`, with the broker stage failing after about 30 seconds and `/api/account/session` returning503. The underlying provider/network/database cause is unproven. No auth/backend repair or guard bypass was attempted. This is the current actual-route blocker, rather than a mere need for credentials.

Actual blocker screenshot: [velora-inbox-access-blocker.jpg](<C:/Users/DELL/.codex/visualizations/2026/11/03/01a1a2b5-3710-72a0-8e93-6bbf32175b53/velora-inbox-access-blocker.jpg>). It documents the access failure, not completed Inbox visual acceptance.

- [x] Actual launcher starts; original inbox route reaches native authentication.
- [ ] Authenticated Desktop screenshot and layout inspection against supplied image.
- [ ] Tablet list/thread and customer Drawer screenshot/interaction.
- [ ] Phone list/thread/details screenshots, safe-area and actual keyboard review.
- [ ] Actual AR/EN navigation, search/filter and details open/close review on final source.
- [ ] Actual permitted write actions, Instagram connected data and AI journey. No permission expansion or real send implied by visual acceptance.
- [ ] Owner final page approval.

Do not mark READY until the authenticated visual checks are recorded. No Commit, Push or Deploy is authorized or performed.

## Resume verification — 2026-11-04, HEAD f43c50f

Owner resumed the inbox task after stopping local servers. Current approved launcher is now `npm run dev` → `scripts/live-customer/start.ps1`, with owner-verified runtime lifecycle. Started successfully on exact origin `http://127.0.0.1:3330`: Next200, Auth200, broker200; native session401/UNAUTHENTICATED. The prior capability-probe outage was not reproduced in this bounded readiness check. No authenticated profile claim.

Browser inspection blocked by current Work setting: local browser use disabled. No alternate browser automation used to bypass this setting. Runtime remains running for owner login; final Desktop/Tablet/Mobile screenshots and layout acceptance still pending. No additional product source changes or repeated tests; scoped native inbox source has no committed drift between d9ad630 and f43c50f. No Commit/Push/Deploy/messages/AI/DB changes.

## Desktop-only inbox refinement — 2026-11-04

Owner authorized Customer Unified Inbox only, no publication. HEAD f43c50ff7d421c3e512f843c1cda7fc4e4b3da07; Graphify build79ea6d83 matches HEAD, indexed2026-11-04T08:22:24.191970Z. Existing WIP preserved. This continuation changes only unified-inbox.tsx (render existing permitted phone), unified-inbox.module.css and conversation-workspace.css (desktop rules >=1024px). No handler, API, permission, provider, SQL, mobile/tablet rule or global design-token change. Existing 1360px details/drawer boundary retained.

Visual changes: 296px list (336px on wide Desktop), wrapped filters without horizontal scrolling, visible native phone numbers, unread emphasis, compact customer summary/details, quieter message spacing, bounded long bubbles, separate staff/assistant fill, fixed composer retained. The current local account exposes read-only WhatsApp controls; no message/note/assignment/AI write attempted.

Minimum verification: TypeScript PASS; scoped ESLint PASS; final PostCSS parse and scoped whitespace PASS; 57 tests across unified-inbox-safety, unified-inbox-realtime, conversations-inbox, conversation-presentation, conversations-composer and instagram-inbox PASS. No full suite/build/CI. Working tree remains uncommitted; index empty; no Push/Deploy.

Actual local Chrome: CSS viewports1280x900,1440x900,1920x1080, document scrollWidth equals innerWidth at all three; filters scrollWidth equals clientWidth267/267/307. Composer bottom remains within viewport.1440 and1280 displayed17real existing messages.1920 native layout/details inspected, but full stable transcript acceptance remains limited by intermittent read failures/loading. Existing fail-closed removal and subsequent recovery observed; underlying cause not diagnosed or changed. Launcher npm run dev refused a foreign-owned existing3330 runtime; it was not killed/restarted. Browser used that real local runtime. Actual channel-entitlement warning UNCONFIGURED remains visible. Instagram connected-data/live writes NOT_RUN.

Screenshots stored under C:/Users/DELL/.codex/visualizations/2026/11/04/01a1a5b2-7611-7840-b47a-41d65e85e5ca/. No mock or generated UI. Visual closure remains partial where live reading is unstable. Files released for handoff; no publishing authority.

## Desktop design completion — 2026-11-04

Continues the owner's goal to finish the same Customer Unified Inbox Desktop design. Local product implementation is complete; publication remains prohibited. This receipt supersedes the earlier1360px drawer boundary and1920px visual limitation for this design only.

Final refinements span five existing product files: unified-inbox.tsx, unified-inbox.module.css, conversation-workspace.css, conversations.tsx and instagram-inbox.tsx. Realtime status now shares the desktop page-header line without hiding failure notices. Customer identity is compact (about81px high), phone/name alignment follows RTL, and native customer details remain inline from1280px. Both existing resize handlers use1280px to close an already-open drawer when entering Desktop; mobile/tablet handling and server/send/permission contracts are retained. No other page, Backend, SQL, provider, API or production environment was changed.

Final evidence: TypeScript PASS; scoped ESLint on three TSX files PASS; both final CSS files parsed PASS; scoped whitespace PASS;46directly affected tests in five suites PASS. The11unchanged list-predicate tests from the preceding receipt were not needlessly rerun. No full suite/build/CI/publication.

Actual native Chrome, authorized read-only customer account:17existing messages observed on final Desktop design at1440x900,1280x900 and1920x1080. At1280, detail panel264px, thread526px, filter client/scroll267px and composer bottom875<900. At1920, detail panel300px, filter307/307 and composer bottom1055<1080. Document scrollWidth equals innerWidth at all three widths. Real search for Ahmed retained the matching customer; cleared afterward. Independent detail/transcript scroll and the fixed composer remain in view. No fake data or synthetic UI; no messages/notes/assignments/AI writes performed. The current account's disabled composer is the existing permission result, not a design placeholder. Instagram live-data acceptance is not claimed.

Screenshots: inbox-complete-1440.jpg, inbox-complete-1280.jpg, inbox-complete-1920.jpg under C:/Users/DELL/.codex/visualizations/2026/11/04/01a1a5b2-7611-7840-b47a-41d65e85e5ca/. External server read failures/loading still intermittently occur and recover; no reliability repair is claimed. Existing UNCONFIGURED channel-entitlement notice is preserved. Design verification succeeded during actual successful reads; this is not launch/security/integration acceptance. No Stage/Commit/Push/Deploy; files released.

## Exact-reference Desktop continuation — 2026-11-04

Owner specifically excludes the existing Velora Sidebar from redesign. It is preserved at168px, white rgb(255,255,255), ink rgb(23,43,40), with the same seven nav links. No navigation source or selector was changed in this continuation; workspace-frame.tsx SHA256 remained EE901A3671183D95E7AD3333F2C40E59AC950D1367659B9691BCFBCDC5E029D2. Prior design-wide styles remain existing WIP, not attributed to this continuation.

Product changes: unified-inbox.tsx, unified-inbox.module.css, conversations.tsx, conversation-workspace.css. Tests extended only in unified-inbox-safety.test.tsx and conversations-composer.test.tsx. Desktop-only pale canvas, three independent14px rounded surfaces,8px gutters, reference-like centered72px native-initial avatar, larger name/contact hierarchy, quiet selected row, bubble spacing and distinct sender types.1440px columns excluding Sidebar:300px list /632px thread /300px detail.1280px:300px list /508px thread /264px detail. This is an improvement against the supplied reference, not an assertion of pixel identity.

Existing functional inventory retained:
- Unified channel inclusion and account/company/membership admission; phone/topic/summary/loaded-message search; all/unread/intervention/automation/resolved filters; native follow-up worklists; ordered pages and load-more controls; URL/history selection.
- WhatsApp authorized thread/history/read receipts; draft preservation; takeover/resume/close with revisions, unresolved-result locks and reconciliation; lead stage, schedule/complete/cancel/reschedule/save; native assignment; saved internal note and note composer portal; permission-gated AI drafts and use-draft; control audit refresh/older events; connection disclosure, knowledge and plan links.
- Instagram scoped rows/thread/read receipt; assignment-to-self/removal; saved reply/readiness/send/new-reply flow, reservation and unknown-result locks; AI draft integration; existing non-text message representation. Instagram has notes=false in current source; no saved-note contract was invented.
- Realtime event coalescing/reconnect and native refresh; UNAVAILABLE/FORBIDDEN/SCOPE_CHANGED errors and fail-closed cache removal. All existing disabled/read-only states remain.

New real local functions:
- Desktop session-only stars: toggle a loaded authorized row, sort starred rows first and filter starred rows. No localStorage, cookie, API or database writes. State is within the existing identity/membership-keyed inbox wrapper; hidden on smaller viewports and excluded from their filtering/order. Main read-failure/revocation events clear this ephemeral UI state. Tooltips/aria labels explicitly describe session-only behavior.
- Native tel and external wa.me links for a syntactically valid existing phone, gated by the existing canReply permission. No automatic call/send, no prefilled message, no provider or server send-policy change. Invalid phone/read-only cases expose no such links; native copy feedback retained.
- Actual browser star/unstar/filter test on Ahmed succeeded (aria-pressed true and one matching row), then filter and star were cleared. No customer message/note/assignment was written.

Minimum safe verification:48distinct tests PASS across five affected suites (13safety,16realtime,3composer,2presentation,14Instagram). After moving the new filter into the existing filter strip, only13affected safety tests were repeated and passed. Final TypeScript, four-file scoped ESLint, both CSS parses, scoped whitespace PASS. No whole-project tests/build/CI; no Stage/Commit/Push/Deploy.

Reference differences and limits: real customer records contain no verified profile photograph/email/address/VIP data; initials/current phone and statuses remain honest. Current authorized local account is read-only, so send/note/AI/contact controls stay permission-gated, rather than fabricated for a screenshot. Existing UNCONFIGURED and automation warnings remain visible. Real long messages differ from sample copy. More operational controls/filters than the image remain accessible. Subjective visual similarity is about75%, not an image-diff measurement or acceptance of missing features. Backend-dependent functions below remain incomplete.

### Backend proposal requiring separate owner approval (NOT IMPLEMENTED)

1. Shared tags: company-scoped tag records and conversation-tag links, guarded read/mutation contracts, membership/branch/channel and assigned-only authorization, input validation and audit. Needs explicit decision on who can create/edit/apply shared tags; no new role/capability is granted here.
2. Durable stars: user+company+channel+conversation key, persisted read/write contract and deletion/isolation behavior. Current session-only stars do not claim durable/team-wide storage.
3. Attachments: private authorized storage/read/upload contract, file validation, a native channel send contract and existing readiness/idempotency/result handling. Existing inbox contracts currently expose text/manual sends and generic non-text reads; no fake paperclip or upload success was added.
4. Missing customer email/address/profile photo and team metadata: approved owning data source plus scoped read/edit contract before exposing invented fields/actions. Native current assignee remains supported. Instagram saved internal notes need an explicit scoped storage/mutation contract.

No SQL/API/schema/permission/Production edits were prepared or applied. Approval must cover the chosen data/API/security scope before implementation; these are proposed dependencies, not already-working features.

## Local backend candidate — 2026-11-04

Owner approved the four-feature backend package for local review only. Added `20261104092239_customer_inbox_extensions.sql`, `src/lib/customer/inbox-extension-actions.ts`, its unit tests, and `scripts/customer-inbox/extensions.postgres.mjs`. The authenticated RPC supports per-user durable stars, shared conversation tags, append-only Instagram internal notes, and private internal attachments. Existing WhatsApp note/send paths are unchanged. Current candidate has no UI wiring. Provider media delivery remains unimplemented.

The RPC reuses the native WhatsApp/Instagram authority and history-account gate, binds records to company/channel/conversation/account/branch, and denies branch-only accounts in the company inbox. Existing reply capability gates shared mutations. Attachments are private database blobs, limited to 512 KiB and 10 per conversation binding, with PNG/JPEG/PDF allowlist and signature checks. Downloads reauthorize on every request. File signatures are not malware scanning. Retention, deletion lifecycle, hosted stack behavior and provider media dispatch remain open.

Four targeted Vitest tests, scoped ESLint and TypeScript passed. Fifteen PostgreSQL assertions passed on isolated PGlite with authority fixtures. Full Velora migration replay and real native session/RLS integration were not verified. No Production SQL or publication.


## PIXEL-ACCURATE INBOX V2 PORT — 2026-11-04

Owner request: port the supplied `C:/Users/DELL/Downloads/Velora_Inbox_Desktop_v2_Preview.html` into the existing `/app/conversations`, without redesign, alternate routes, Backend/Auth/SQL/RLS changes or publication before visual approval. Source SHA256: `043a60dc7e522df7439582144175ed9831b4f8509fbeb78a6cdf1c3c46361e95`. HEAD stays `3be7a0c75c341565fd0a5b917a4ef9372ea89786`, main. Graphify build `57d5f523-4034-4ecc-a56d-82086c6122ae`, indexed 2026-11-04T14:07:22.957203Z, matches HEAD; current uncommitted source was verified separately.

Implemented locally:
- Original reference components ported to typed TSX in `src/components/app/inbox-desktop.tsx`: InboxDesktop, WorkspaceBar, ListPanel, ThreadPanel, ClientPanel, WorkflowBar, ComposerView, FollowUpPanel, ActivityPanel and ConnectionPanel; original SVG paths preserved. React 19 from the project; no embedded React 16, demoAction, alert, demo records or iframe.
- Original reference CSS declarations in `inbox-desktop-reference.css`; selectors scoped with sufficient specificity to defeat native app button defaults. Preview body/layout/sidebar rules were excluded. Existing site sidebar remains unchanged. Existing non-desktop native layout retained; no alternate app route added.
- `inbox-desktop-adapter.ts` projects already-authorized channel-qualified rows and WhatsApp messages. Native panes supply verified customer/assignment, workflow, connection, composer, follow-up and audit data and their existing handlers. No invented avatars, VIP badges, tags, employee names or readiness.
- Stateful native follow-up/notes and AI panels remain mounted while switching modes; unresolved send/control IDs, permission checks, drafts, epoch/scope fences, pagination, transcript scroll preservation and Realtime remain with their owning native components. Only supported modes appear; Instagram retains its save-then-send workflow and rollout/readiness protection.

Visual evidence (local, outside Git): `.git/inbox-v2-port/`.
- `reference-1419.png`: original supplied HTML at 1419x776 in real Chrome.
- `port-1419.png`: actual ported React 19 components plus actual final product CSS, driven by the same reference fixture in an isolated browser document. Fixture script and images stay in the test harness outside production; no web route was created.
- `overlay-1419.png`, `diff-1419.png`, `comparison.json`: exact pixel comparison: 0 changed pixels, mean channel error 0. The complete image includes the unchanged preview shell for comparison only. This proves the presentation port under identical fixture/browser/font inputs; it does not equate synthetic results with Backend acceptance.
- Reference breakpoints checked at 1280/1360/1700/1920; no horizontal overflow, original responsive column rules retained. See `visual-final.log`.
- `native-1419.png`: final real `/app/conversations` with existing authorized TAG CITY data. Observed 2 real conversations and 19 messages; native search `Ahmed` reduced list to1 and clearing restored2. At1419x776: customer292px, thread519px, list324px, rows92px, composer145px, root756px tall, no horizontal overflow. Native sidebar is wider than the preview sidebar, so remaining thread width differs intentionally under the owner's instruction to preserve it. Real UNCONFIGURED entitlement warning and restricted reply permissions remain truthful.
- Live reads transiently failed and the session boundary changed during verification; the native page removed customer/thread content, then reloaded through the existing verification link and recovered the same authorized data. Realtime connected at final observation. This is a bounded read-only UI observation, not a long-term reliability or performance claim. No customer messages, AI requests, assignment/control/lead saves, provider changes or financial operations were initiated; existing native read acknowledgements were retained. Live Instagram and permissioned mutation journeys NOT_RUN.

Verification:
- 94 tests across9 affected suites PASS (`tests-frozen.log`): native WhatsApp composer/contact behavior, newly covered ported notes persistence/save binding and suspended authority, reference fail-closed renderer, Instagram save/reservation/readiness guards, assignment/worklist/search, Realtime and scope isolation. Final follow-up projection rechecked with6 composer tests (`tests-final-followup.log`).
- TypeScript PASS (`types-frozen.log`); affected ESLint with `--max-warnings=0` PASS (`lint-scoped-frozen.log` plus final follow-up lint); final production Next webpack build PASS (`build-delivery.log`, exit0) after the final selector-scoping and follow-up projection changes.
- Whole-repository ESLint FAIL outside this package: `scripts/account-deletion/native-test-order.mjs:33` assigns `module`; five warnings in other pre-existing untracked account-deletion/performance/setup-trial scripts. No unrelated lint files were changed and no security/lint gate was bypassed. See `lint-all.log`.
- Tracked secret baseline PASS(2405paths), new-source secret signatures PASS(3files), security/safety self-tests13PASS. CSS parsed/scoping check233rules PASS; no preview shell/sidebar selectors. Scoped `git diff --check` PASS. Full hosted CI NOT_RUN.

Changed by this task:
- `src/components/app/unified-inbox.tsx`
- `src/components/app/unified-inbox.module.css`
- `src/components/app/conversations.tsx`
- `src/components/app/instagram-inbox.tsx`
- `src/components/app/inbox-desktop.tsx` (new)
- `src/components/app/inbox-desktop-reference.css` (new)
- `src/components/app/inbox-desktop-adapter.ts` (new)
- `src/components/app/conversations-composer.test.tsx` (extended existing local file)
- `src/components/app/instagram-inbox.test.tsx`
- This receipt, first PROJECT_STATE index, and Brain04 task receipt.

Status: local port implemented; identical-fixture visual comparison verified; bounded native data/search observed. Pending owner visual acceptance and resolution of whole-repo lint outside this package; no staging, commit, push, deploy, migration or production configuration changes. Other local WIP preserved.


## Native reference extensions — owner refinement 2026-11-05

Integrated the supplied extension models into the original inbox, preserving actual data and native actions. No demo state/render/action, invented event/employee/branch, fixed counters, fake save feedback or hardcoded connected readiness was copied.

- Reference filters now expose native channel/worklist filtering, counts from authorized loaded rows, and all six canonical manual lead stages. Worklists include unread, awaiting staff reply, today, overdue, trial/quote, automation, resolved and native human-review. Counts are explicitly scoped to loaded pages. Unsupported lead/status filters are omitted for Instagram-only queues; stale unsupported deep links normalize safely. Filtering does not fetch or discard the open pane/draft.
- Reference FollowUpPanel is driven by LeadFollowUpPanel's existing server-draft fields, saveLead, runLeadSavePath and expectedLeadRevision. Save/complete/cancel, required reason, scheduled time, pending/denied controls, conflicts and uncertainty remain native. Assignment editor and internal-note portal remain mounted. Display timezone identifies the actual browser-local datetime input; differing business timezone is shown separately, with the existing announced-UTC notice. Existing UTC conversion and scheduling policy were not changed.
- Workflow renders the existing take-over/resume/close controls with reference emphasis and truthful disabled reasons; native permission checks and runControl guards remain. Activity uses actual control-audit events and real cursor pagination, with actor names only when returned or resolved from actual assignees. Connection details opens the existing native accordion; readiness is the verified backend binding, or unverified. History and list pagination retain native protected calls; list buttons use reference styling. Workspace freshness appears only after an accepted real snapshot refresh.
- Source/test paths: unified-inbox.tsx, conversations.tsx, inbox-desktop.tsx, inbox-desktop-adapter.ts, conversations-composer.test.tsx, unified-inbox-realtime.test.tsx. Final hashes in `.git/inbox-v2-port/extensions-final-hashes.json`.
- Verification:76affected testsPASS across5suites (`tests-extensions-release.log`), including native follow-up save binding/revision, complete/cancel failure honesty, disabled control permissions, filtering/draft preservation, unsupported Instagram filters/deep links, Realtime/scope/Instagram safeguards. TypeScript/scopedESLint zero warnings/final Next webpack buildPASS (`types-extensions-final.log`, `lint-extensions-release.log`, `build-extensions-release.log`); six-source secret-signature scan and scoped whitespacePASS. Earlier whole-repo lint blockers outside this package remain unchanged; hostedCI NOT_RUN.
- VISUAL_NOT_VERIFIED for this refinement: last native browser check was blocked by inbox read failure; final reload attempt reported a detached browser debugger. No substitute fixture was presented as real Backend acceptance. No live send/lead/control/assignment/provider/financial action was initiated. No Backend/Auth/SQL/RLS/policy change, staging, Commit/Push/Deploy or new route. Local implementation, pending visual acceptance; other WIP retained.


## INBOX-CONNECTION-PRESENTATION-20261105 — local implementation verified

Owner requested that connection loss no longer replace/hide the inbox behind the server-read error banner. Root cause confirmed in current code: read helpers collapsed fetch exceptions into ordinary UNAVAILABLE; parent refresh cleared retained presentation and replaced the page. No Backend/Auth/SQL/RLS or provider change was authorized or made.

- Local fetch failures/timeouts now carry an explicit transport-only marker in both private GET helpers. HTTP denials, HTTP5xx, malformed bodies and unknown server authority remain separate failures. Any marker arriving in a server body is stripped, so a response cannot authorize its own cached-data fallback. Company/actor/thread checks, credentials, no-store, timeout, epoch and membership fences remain.
- A verified in-memory inbox/thread stays mounted during classified transport loss, retaining messages, scroll state, drafts and unresolved operation IDs. Browser offline and SSE disconnection pause controls immediately. Parent fieldset and native reply/lead/control/Instagram save/send/assignment/AI/read-ack guards pause writes; online/reconnect alone never re-enables actions. A new accepted native read is required. No localStorage/persistent private cache, background service, automatic send or mutation retry was added.
- Unknown/unclassified server authority failures still erase private content, but now preserve the inbox shell and show a compact connection status/retry instead of the old page-replacing red banner. Unknown counts/filters are omitted and unknown data is not presented as an empty successful inbox. Confirmed denial, session/company/actor changes, revocation and channel loss still clear data; later transport failure never restores denied content. Instagram also clears an earlier thread after explicit read denial.
- Native read-only observation: re-bound existing local Chrome tab; actual2conversations/19messages displayed while the Realtime status was offline, then19messages and connected status remained at capture. `.git/inbox-v2-port/connection-retained-native.png` is the recovered real-data view, with no old server-read banner. A physical device/network disconnect was NOT performed; controlled outage/recovery/denial scenarios were exercised in local tests. No live sends, AI/control/lead/assignment/financial/provider actions were initiated.
- Final validation:97tests across7affected suitesPASS (`tests-connection-retain-final.log`), including transport/HTTP/body separation, forged flags, pause/recovery, native draft/transcript retention, forced-submit/ack denial and explicit scope/permission erasure. TypeScript/scopedESLintzeroWarnings/finalNextwebpackBuildPASS (`types-connection-retain3.log`, `lint-connection-retain-final.log`, `build-connection-retain.log`); seven production-source secret-signature checks and scoped whitespacePASS. Existing whole-repo lint blockers outside package unchanged; hostedCI NOT_RUN.
- Thirteen changed source/test paths and final hashes: `.git/inbox-v2-port/connection-retain-hashes.json`. MainHEAD remains3be7a0c75c341565fd0a5b917a4ef9372ea89786; matchingGraphify57d5f523. No staging/Commit/Push/Deploy; other local WIP retained; source files released. This local scoped UI behavior does not claim full offline Auth, live Instagram mutation acceptance or platform readiness.


Owner refinement 2026-11-05: added the requested conversation-header strip in reference RTL order (assignment, follow-up, tags, session star, more). Existing native assignment/star callbacks reused; follow-up opens its native panel; more opens customer details/activity/connection/refresh. Unsupported tags and unauthorized assignment visibly disabled with localized reasons. Fixed menu stacking over workflow controls; native browser verified follow-up, activity, details and closing menu. Screenshot .git/inbox-v2-port/header-actions-native.png. TypeScript/scoped ESLint/whitespace PASS; no live mutations, Backend/SQL/provider changes or publication.


Owner refinement 2026-11-05: composer footer now shows reference more/quick-replies/emoji/attachment icons in screenshot order. Existing custom tool callbacks preserved. Default emoji picker inserts into the native controlled draft at selection; guards pending/canSend. Unsupported attachments/quick replies/extra tools disabled with localized reasons. Native browser verified four icons and disabled state for current read-only account; screenshot .git/inbox-v2-port/composer-tools-native.png. Interactive emoji use NOT_RUN due native reply permission. TypeScript/scoped ESLint PASS; local only, no messages sent or Backend/provider/SQL/publication changes.


Owner refinement 2026-11-05: customer hero now displays WhatsApp/email/call/more quick actions in reference RTL order with circular outline icons. Existing native phone/WhatsApp callbacks preserved; missing contact actions remain disabled with reasons. Moved existing copy-number action into customer More menu alongside native activity/follow-up navigation. Customer distinguished badge follows existing session-star state (not a persistent VIP classification). Native browser verified menu navigation and star badge; screenshot .git/inbox-v2-port/customer-quick-actions-native.png. TypeScript/scoped ESLint/whitespace PASS. No calls/email/customer messages, Backend/SQL/provider changes or publication; local session star enabled during UI verification.


Owner refinement 2026-11-05: Contact information always displays phone/email/location rows with their reference icons. Missing, empty or whitespace-only values render Arabic لا يوجد (localized English fallback); no reference/demo contact data added. Native browser shows actual phone and two missing values; screenshot .git/inbox-v2-port/contact-information-native.png. TypeScript/scoped ESLint/whitespace PASS. Local UI only; no Backend/SQL/provider changes, staging or publication.


Owner refinement 2026-11-05: customer Tags section now always visible after Contact information, including reference Add tag (+) control and existing real tag chips. Empty data displays لا يوجد; no demo tags inserted. Existing addTag callback reused when present; unsupported save remains disabled with localized reason. Native browser verified section/button disabled/empty state; screenshot .git/inbox-v2-port/customer-tags-native.png. TypeScript/scoped ESLint/whitespace PASS. Local UI only, no Backend/SQL/provider changes or publication.


Owner refinement 2026-11-05: Internal notes section now always visible after Tags with reference Add note (+) button and bordered note card. Existing native edit callback retained; label switches for a saved note, metadata shown only when available. Missing note displays لا يوجد; no demo text/author/timestamp added. Current account addition disabled with localized reason. Browser verified empty card/button, screenshot .git/inbox-v2-port/customer-notes-native.png. TypeScript/scoped ESLint/whitespace PASS. Local UI only; no note save, Backend/SQL/provider changes or publication.


Owner refinement 2026-11-05: customer assigned-team block now includes native assignee avatar/name when available, presence-unavailable fallback, and permission-gated down-chevron assignment action. No assignee displays لا يوجد; unavailable authorized display name no longer exposes raw ID. Next follow-up uses selected saved followUpAt/status and business timezone (explicit UTC fallback); absent appointment displays لا يوجد. WhatsApp footer shows verified native channel/auth status; paused reads show unverified readiness instead of stale ready claims. No invented teammate/photo/presence/date. Native selected customer confirmed no assignee/no appointment; channel recovered unverified→connected/ready. Screenshot .git/inbox-v2-port/customer-team-followup-native.png. 27affected tests/TypeScript/scoped ESLint/whitespace PASS. No live assignment/follow-up saves, Backend/SQL/provider changes or publication.


Owner refinement 2026-11-05: follow-up form restyled to supplied screenshot: compact heading/labels, 32px stage/status/date fields, full-width 34px teal save button, and paired 29px complete/cancel controls. Date field and completion/cancellation actions always visible; date enabled/required only for scheduled status, unsupported actions disabled. Existing native drafts/save handlers, reason requirement, permissions and timezone notices retained; no appointment fabricated. Browser verified native form on current unscheduled/read-only customer; screenshot .git/inbox-v2-port/followup-reference-native.png. 27affected tests/TypeScript/scoped ESLint/whitespace PASS. No live save/state mutation or publication.


Owner refinement 2026-11-05: activity tab restyled as reference compact RTL timeline: small teal dots/connecting lines, heading/event/actor/time hierarchy and Load older activity button using native audit cursor. Actual existing audit events retained; missing actor shows لا يوجد / unavailable authorized name rather than raw ID. Timestamps formatted in business timezone with explicit UTC fallback. Native browser verified real events and enabled older activity action; screenshot .git/inbox-v2-port/customer-activity-native.png. TypeScript/scoped ESLint/whitespace PASS. No fake events/names or Backend/SQL/provider changes, live mutations or publication.


Owner refinement 2026-11-05: incoming customer messages now render the selected customer Avatar next to the bubble, aligned at its top, with timestamp on the opposite side as supplied reference. Existing actual avatarUrl used when available and initials/image-error fallback retained; no WhatsApp photo fetch or invented portrait. Outgoing author handling unchanged. Browser confirmed native incoming rows render A for current customer without photo URL; screenshot .git/inbox-v2-port/customer-message-avatar-native.png. TypeScript/scoped ESLint/whitespace PASS. Local UI only, no Backend/provider/SQL changes, live sends or publication.


Owner refinement 2026-11-05: WhatsApp composer now shows ownership notice above textarea from selected verified automation state: AI handling, staff handling, blocked AI, or resolved conversation. Paused transport prefixes last verified state; existing separate connection/permission reasons and all send guards retained. Updates naturally with native control result/read state; no live takeover/resume executed. Native screenshot confirms staff handling on current paused-automation customer: .git/inbox-v2-port/composer-ownership-native.png. 27affected tests/TypeScript/scoped ESLint/whitespace PASS. AI/resolved live transitions NOT_RUN; no Backend/SQL/provider changes or publication.


Owner refinement 2026-11-05: completed reference transcript layout plus customer details hide/restore controls. Customer inbound bubbles remain gray/right with no avatar per final reference; outbound mint/left bubbles show actual author avatar when supplied, otherwise neutral AI/staff icon from recorded sender kind (no invented photo/identity). Explicit nonstretch row spacing and compact timestamp/delivery styling. Details close arrow collapses customer column, leaves mounted draft panels intact; visible header restore action and responsive two-column widths restore access. Hide state scoped to workspace. 27affected tests/TypeScript/scoped ESLint/whitespace PASS. Visual/toggle runtime acceptance NOT_RUN: browser control disabled in Work settings. No new screenshot claimed; no live mutations/Backend/SQL/provider changes or publication.


Owner correction 2026-11-05: outgoing assistant reply appeared centered in supplied native screenshot. Explicitly made transcript article rows full width/max-width none/align-self stretch, retaining bounded bubble width and LTR flex-start for outbound rows. This pins outgoing content to left edge independently of intrinsic article sizing; customer bubbles retain right alignment. CSS parse/whitespace PASS. Visual acceptance pending: browser use remains disabled in Work settings; no fresh screenshot claimed. CSS-only local change, no publication.


EXACT-INBOX-TYPOGRAPHY owner request 2026-11-05: extracted 77 typography rules directly from available Downloads/Velora_Inbox_Desktop_v2_Preview.html (requested Preview(3).html absent). Applied final inbox-only scoped cascade with important typography declarations, retaining source media query at1280-1359, 13px/1.65 base, 14px/1.9 bubbles, 10px timestamps, original 600/650/700/750 weights. Scoped Cairo variable override and inherited descendant font prevent native utility font replacement; sidebar/site files untouched. Existing local font proven family Cairo, variable wght200-1000 and Arabic glyph coverage via fontTools; local asset HTTP200/font-woff2/100400bytes. CSS parse,104protected declarations/seven key source-value checks/scoped selector/whitespace PASS; .git/inbox-v2-port/typography-verification.json. Browser getComputedStyle/document.fonts and equal-viewport/zoom visual comparison BLOCKED: local browser use disabled in Work settings. No visual parity claim, commit/push/deploy or Backend changes.


Owner alignment correction 2026-11-05: prior full-width override did not resolve supplied screenshot. Proven owning source conflict: conversation-workspace.css legacy high-specificity app-shell/channel-pane data-message-id rules constrain width80%/76%/680px and override direct child order, size, padding. Scoped all25legacy message selectors to exclude .vdi-message and legacy transcript selectors to exclude .vdi-messages; retained non-transcript guard semantics. Native legacy/mobile selectors still apply to original non-VDI nodes. VDI now solely owns transcript geometry/typography. CSS parse/25selector-isolation/whitespace PASS. Browser acceptance remains BLOCKED by Work setting disabling local browser; no new screenshot or visual success claimed. Local CSS only; no publication.
