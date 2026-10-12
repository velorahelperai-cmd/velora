# WhatsApp Business App coexistence release handoff

This is an implemented, inactive source change, with reviewed SQL awaiting genuine database acceptance. It is not evidence of a live Meta connection. The sole integration/release writer is thread `01a1293c-1dfb-740c-9e4a-e4e33053a060`; apply the frozen patch through that writer only.

## Source and ownership

The final source baseline is clean published `e5b0b80acea473266e7fbf6381cae70babc85746`, verified locally and against the actual remote `velorahelperai-cmd/velora`. It descends from the accepted product baseline `281468d00bd02688ed9b45730de062720031324f`. All 959 initial candidate paths were compared against that checkout; the candidate-only runtime harness difference was restored to published bytes before packaging. No branch, commit, original/release checkout edit or runtime was created by this implementation. At final inspection both original and release checkouts are clean at e5b0b80; their advancement was external to this task. Initial ec3c91e design and IG plan work was not overwritten by this agent.

New source ownership is `src/lib/whatsapp/coexistence/*`, the dedicated coexistence component/test, the WhatsApp coexistence SQL review package and these documents. Existing source changes are confined to the signup wrapper, exact tenant resolver, webhook route and phone-scoped revocation parser, plus adjacent tests. Shared authentication and inbox source were not edited.

The controlling Library specification was read in full, all 234 lines. Supported local transfer failed on Windows file metadata before atomic installation. No artifact was reconstructed or restriction bypassed. The owner's later explicit instruction allowed continued implementation using that full read and official documentation.

## Resulting behavior

- The keep-on-phone choice selects a dedicated coexistence signup path. Independent-number Cloud API signup retains its existing guards and registration path.
- The owner confirms the exact company number. Native current-session authorization precedes one-use company/user/session-bound nonce claims. Popup origins and supported completion signals are bounded and validated. Code exchange and app/scopes/expiry/full asset discovery stay server-side; ambiguous number selection is rejected.
- A per-attempt encrypted Vault credential and verified checkpoint commit before WABA subscription. Provider uncertainty or local persistence failure keeps reconciliation evidence and blocks blind repeat. Finalization records the actual link/generation and enforces unique tenant binding. No coexistence registration/deregistration operation exists.
- Signed live inbound for coexistence uses canonical inbox persistence without AI jobs. History, contacts, chunks, media placeholders and mobile echoes use immutable receipts and canonical projection with deduplication, chronology and conflict retention. Holding before finalization is bound to a real verified signup attempt with no fabricated link. Recovery is local and generation-bound; held inbound recovery becomes historical and cannot mint a service window.
- Existing manual replies retain window, entitlement, per-connection secret and accepted-versus-delivered checks. Delivered/read proof requires the exact accepted staff intent and current link after signed status persistence. Authorization saved and actual live verification remain separate.
- History and app-state sync require separate owner consent, a one-use persisted request per link/generation/type, and service credential consumption before the provider request. Provider acceptance means pending; webhook evidence determines progress. Unknown requests cannot be retried automatically.
- Disconnect revokes local access durably and blocks subsequent use. In-flight signup evidence is retained; late finalization cannot reactivate it. Phone-scoped partner removal stays phone-scoped, including second-resolution timestamps. Mobile unlink remains the user's Business app Settings / Account / Business Platform / Disconnect Account action.

## Frozen database contracts

Use `coexistence-work/acceptance-freeze-v3/manifest.json`. V3 changes only the adapter's known SQL denial mapping from V2; SQL20 and SQL30 are byte-identical to V2. The DB worker can finish SQL acceptance started with V2 without discarding that work.

Apply the accepted baseline through `20261010100003`, then these review packages in order:

| Package | Raw SHA256 |
| --- | --- |
| 10-observations | `707da6fc075009ccbf868e659f0cee623d2ee8ee1a6e6a2b5fcc1e0bdacdbabb` |
| 20-signup | `eb0e748a0bafc6cd8cf32bd884ce8c92441d6d7fb91d3cc1da873fe3a9dc40f4` |
| 30-projection | `5163644b6b8dc40166c64405c28ffc4f979cd58b8345a7fabb92915721904276` |
| 40-sync, separate reviewed freeze | `328b6c1251fa81a999f3515b334254329e4a37a168ff6f1cb86e9fd2805b1049` |

The ingress contract has exactly 20 scalar arguments, including media: `p_waba_id,p_phone_number_id,p_display_phone_number,p_kind,p_event_key,p_customer_wa_id,p_wa_message_id,p_direction,p_message_type,p_body,p_provider_occurred_at,p_contact_action,p_contact_name,p_history_phase,p_history_chunk_order,p_history_progress,p_history_error_code,p_disconnection_reason,p_initiated_by,p_media_id`. SQL20 readiness checks this actual signature. Migration source is intentionally untimestamped and unapplied; the release writer must generate supported forward migrations after real acceptance. The accepted private helper prerequisite raw hash is `46c5053a8fa20e0a6ec3330ad1d1e07799dc7deeaf84e29e04904ab79b673f26`.

## Verification and remaining gates

The coherent source run passed 239 focused tests. The final adapter/route denial correction subsequently passed 56 focused tests (42 adapter +14 route), with the remaining 193 test results unchanged: 250 distinct focused cases cover the current wiring. Scoped integrated source TypeScript passed, including all coexistence sources, UI, signup wrapper, tenant resolver and webhook route. The original unchanged foundation has earlier 127 focused passes and an independently verified frozen archive. Independent static reviews resolved actual finalized-generation binding, same-second removal, in-flight disconnect, fresh owner sync session and exact sync source-attempt findings.

These are offline adapter/component/static checks. Genuine SQL execution, locks/RLS/ACL, native GoTrue/PostgREST, browser interaction and live Meta proof have not been claimed. The authorized DB worker is `01a12cb1-afd9-7564-836f-6826aa0b106e`, with its isolated fixture at `C:/Users/DELL/Documents/Codex/2026-10-12/task-2/coexistence-acceptance`. It owns the local runtime slot; this task did not start Docker, Next, a build or a competing port. Direct thread handoff attempts failed because the app tool reported an invalid target workspace path; the parent must relay these frozen manifests.

Real DB acceptance must cover tenant/role/session fences; native owner expiry; claim/nonce replay; wrong assets/app/scopes and secrets; external success/local-save failure; retained checkpoint receipts after logout; disconnect during claimed/checkpointed signup; stale attempt recovery after a new generation; exact/conflicting/concurrent replay; history/echo/contact zero AI/send/window effects; out-of-order/media identity; real inbox reads; and revoked manual-send rejection. SQL40 additionally needs fresh owner session B after original session A logout, exact source generation, one-use concurrent requests, unknown outcomes, revocation around credential consumption, and no completed state from `request_id` alone.

## Activation and live proof

Rollout is default off. The source requires `WHATSAPP_COEXISTENCE=true`, `WHATSAPP_ROUTING_MODE=tenant_registry`, a dedicated `WHATSAPP_COEXISTENCE_CONFIG_ID` distinct from the legacy config, and the existing server-only app/Graph credentials. This handoff changes none of them. Existing webhook mTLS remains enabled. Only after handlers and acceptance are established may an approved operator verify the official `account_update`, `history`, `smb_app_state_sync`, `smb_message_echoes` subscriptions. No blind subscription changes are authorized.

The supplied app/business/config and old phone/WABA IDs are context only. Recheck mobile activation and eligibility, chosen company UUID and actual newly authorized assets. The owner stated +96877958544 is for Velora, but mobile activation was still incomplete at the latest confirmation. Do not bind it to the reviewer workspace by assumption. Get the specific required approvals for production migration/grants, secrets/rollout, provider configuration or OAuth authorization, real messages and reconnect/disconnect before each exact gated action. No paid AI, real grants, live messages, registration, deregistration, asset deletion or app-review submission was performed.

Live acceptance must show: mobile Business app still works; real Velora connect survives reload; external inbound appears in the correct company; one deliberate manual outbound reaches the recipient; a mobile echo appears once; another company cannot read/send/control it; and the chosen disconnect stops use without deregistering the mobile number. Automated replies remain disabled.

History excludes groups and has provider-defined 180-day/14-day media limits. Canonical media download is not implemented; placeholders/private identifiers are retained without fabricated download links. The sync deadline conservatively begins at local signup preparation, potentially shorter than Meta's full 24 hours. UI reports known pending projection/conflicts and saved sync states; provider progress 100 is not proof that every historical item is visible. A delivery status arriving before a staff send has finalized is retained by the existing status/rebind path; live-verification stamping may await a later signed status/replay. Do not claim live send verification from HTTP acceptance.

## Official evidence

The verified official contract is preserved in `official-contracts.json`: [Business App onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/), [Embedded Signup version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/) and their linked implementation/account-management pages. The dedicated feature is `whatsapp_business_app_onboarding`; completion is `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`. Version-4 configuration does not invent a session version, and documented WABA-only compatibility does not select an arbitrary first number.
