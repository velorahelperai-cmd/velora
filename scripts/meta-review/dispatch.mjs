// Offline real SQL review dispatch tests. Supabase Vault and the older WA core are labelled contract doubles.
import assert from 'node:assert/strict';
import {setup,reset,id,sql,lit,save,installed,signed,conv,prefix,fingerprint,claim,settle,project} from '../instagram-send/manual-fixture.mjs';
import {cleanup,file} from '../instagram-connection/postgres.mjs';
import {setup as sendSetup,reset as sendReset} from '../instagram-send/fixture.mjs';
import {readFileSync} from 'node:fs';
const server="set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
try{
 await sendSetup();
 // Empty financial row types only. Review sends must not seed a payment or subscription.
 await sql(`create table public.billing_subscriptions(id uuid primary key,company_id uuid,environment text,status text,paid_through timestamptz,plan_version_id uuid);
 create table private.billing_proven_entitlement_grants(id uuid,company_id uuid,subscription_id uuid,provider_environment text,applied_paid_through timestamptz,plan_version_id uuid,order_id uuid,payment_attempt_id uuid,provider_event_id uuid);`);
 await file('supabase/migrations/20261011212721_vel_instagram_manual_reply_producers.sql');
 await sql(`create table public.whatsapp_conversations(id uuid primary key,company_id uuid,phone_number_id text,customer_wa_id text,assigned_to uuid);
 create table public.whatsapp_messages(id uuid primary key,company_id uuid,conversation_id uuid,wa_message_id text,received_at timestamptz,direction text,sender text);
 create table public.whatsapp_send_intents(id uuid primary key,company_id uuid,conversation_id uuid,phone_number_id text,recipient_wa_id text,sender_kind text,actor_user_id uuid,staff_actor_session_id uuid,link_id uuid,link_generation bigint,body text,outcome text,attempt_token uuid,attempt_expires_at timestamptz,staff_dispatch_token uuid,staff_dispatch_authorized_at timestamptz,staff_claim_plan_version_id uuid,staff_claim_paid_through timestamptz,
 constraint wa_staff_dispatch_binding_complete check ((staff_dispatch_token is null and staff_dispatch_authorized_at is null) or (staff_dispatch_token is not null and staff_dispatch_authorized_at is not null and sender_kind='staff' and staff_actor_session_id is not null and staff_claim_plan_version_id is not null)));
 create function private.wa_claim_pre_fixed_ack(i uuid,u uuid,seconds int) returns jsonb language plpgsql as $$declare r public.whatsapp_send_intents%rowtype;begin update public.whatsapp_send_intents set outcome='attempting',attempt_token=gen_random_uuid(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i and outcome='ready' returning * into r;if not found then return jsonb_build_object('ok',true,'claimed',false);end if;return jsonb_build_object('ok',true,'claimed',true,'attempt_token',r.attempt_token,'intent',to_jsonb(r));end;$$;
 create function private.wa_staff_session_authority(u uuid,s uuid,c uuid,a uuid) returns boolean language sql as $$select current_setting('role',true)='authenticated' and auth.uid()=u and auth.jwt()->>'session_id'=s::text and exists(select 1 from auth.sessions where id=s and user_id=u)$$;
 create function private.require_platform_admin() returns uuid language plpgsql as $$begin if not exists(select 1 from public.platform_admins where user_id=auth.uid() and role='owner' and status='active') then raise insufficient_privilege;end if;return auth.uid();end;$$;
 create function private.can_admin_company(cid uuid,cap text) returns boolean language sql as $$select exists(select 1 from public.platform_admins where user_id=auth.uid() and role='owner' and status='active')$$;`);
 const provenanceSource=readFileSync('supabase/upgrade-packages/two-rpc-compatibility-v3/20-staff-dispatch.candidate.sql','utf8');
 const start=provenanceSource.indexOf('create function private.wa_staff_dispatch_provenance()');const end=provenanceSource.indexOf('revoke all on function private.wa_staff_dispatch_provenance',start);
 assert.ok(start>=0&&end>start);await sql(provenanceSource.slice(start,end));
 await sql('create trigger whatsapp_staff_dispatch_provenance before insert or update on public.whatsapp_send_intents for each row execute function private.wa_staff_dispatch_provenance()');
 await file('supabase/migrations/20261013162534_meta_review_manual_authority.sql');
 // Substitute only the two explicitly declared contract-double pins in this isolated fixture.
 // The production migration is always applied unchanged and pins the genuine installed kernel.
 const fixtureCoreHash=await sql("select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.wa_claim_pre_fixed_ack(uuid,uuid,integer)'::regprocedure");
 const fixtureSessionHash=await sql("select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='private.wa_staff_session_authority(uuid,uuid,uuid,uuid)'::regprocedure");
 await sql(readFileSync('supabase/migrations/20261013162547_meta_review_channel_dispatch.sql','utf8').replace('853cf92ee5ab3e4fae74e0b4c5f4ef0e',fixtureCoreHash).replace('fbb2385d31deacab2f65535b1b32da59',fixtureSessionHash));
 await file('supabase/migrations/20261013170554_instagram_review_signed_bootstrap.sql');
 await sendReset();await sql("truncate private.instagram_send_windows;update private.instagram_provider_contracts set app_id='1000';update private.instagram_oauth_attempts set app_id='1000';update private.instagram_company_links set app_id='1000'");await installed();await signed();
 const grant=async(channel,asset,source,recipients,fp=fingerprint)=>JSON.parse(await sql(`${prefix(15,26)}select public.admin_grant_channel_review('${id(1)}',${lit(channel)},'1000',${lit(asset)},${lit(source)},array[${recipients.map(lit).join(',')}],${lit(fp)})`));
 const ig=await grant('instagram','100','100',['200']);assert.equal(ig.ok,true);
 const saved=await save();assert.equal(saved.ok,true);
 await sql('truncate private.instagram_send_policy');
 assert.equal((await claim(saved.binding)).code,'SEND_DISABLED');
 const readiness=JSON.parse(await sql(`${prefix()}select public.instagram_review_send_readiness('${id(1)}','${await conv()}')`));assert.equal(readiness.ok,true);assert.equal(readiness.blockers.includes('ENTITLEMENT_DENIED'),false);
 const igClaim=()=>sql(`${server}select public.instagram_claim_review_send(${lit(JSON.stringify(saved.binding))}::jsonb,'${ig.grant.id}')`).then(JSON.parse);
 const fresh=await igClaim();assert.equal(fresh.kind,'fresh');assert.equal(fresh.committed,true);
 assert.equal((await igClaim()).kind,'existing');assert.equal(await sql(`select used_count from private.channel_review_grants where id='${ig.grant.id}'`),'1');
 assert.equal(await sql('select count(*) from public.billing_subscriptions'),'0');
 assert.equal(await sql('select entitlement_proof is null and review_grant_id is not null from private.instagram_send_intents'),'t');
 assert.equal((await settle(saved.binding,fresh.claimReceipt,{status:'accepted',recipientId:'200',messageId:'mid.offline-review'})).ok,true);
 assert.equal((await project(saved.binding)).ok,true);
 const wa=await grant('whatsapp','500','600',['96890000000']);assert.equal(wa.ok,true);
 await sql(`insert into public.whatsapp_conversations values('${id(501)}','${id(1)}','500','96890000000',null);
 create function public.fixture_create_wa(i uuid) returns void language sql security definer as $$insert into public.whatsapp_send_intents(id,company_id,conversation_id,phone_number_id,recipient_wa_id,sender_kind,actor_user_id,outcome) values(i,'${id(1)}','${id(501)}','500','96890000000','staff',auth.uid(),'ready')$$;grant execute on function public.fixture_create_wa(uuid) to authenticated;`);
 await sql(`${prefix()}select public.fixture_create_wa('${id(502)}')`);
 const waClaim=()=>sql(`${server}select public.claim_whatsapp_review_send('${id(502)}','${id(11)}','${wa.grant.id}')`).then(JSON.parse);
 assert.equal((await waClaim()).code,'service_window_closed');
 await sql(`insert into public.whatsapp_messages values('${id(503)}','${id(1)}','${id(501)}','wamid.inbound',clock_timestamp()-interval '1 minute','inbound','customer');
 insert into private.review_whatsapp_inbound select id,company_id,conversation_id,'600','500','96890000000',wa_message_id,received_at,'${fingerprint}' from public.whatsapp_messages;`);
 const waFresh=await waClaim();assert.equal(waFresh.claimed,true);assert.equal(waFresh.review_entitlement.grant_id,wa.grant.id);
 const dispatch=()=>sql(`${prefix()}select public.whatsapp_authorize_review_dispatch('${id(502)}','${waFresh.attempt_token}','${wa.grant.id}')`).then(JSON.parse);
 assert.equal((await dispatch()).authorized,true);assert.equal((await dispatch()).authorized,undefined);
 assert.equal(await sql(`select staff_claim_plan_version_id is null and staff_claim_paid_through is null and staff_review_grant_id is not null from public.whatsapp_send_intents where id='${id(502)}'`),'t');
 await sql(`${prefix()}select public.fixture_create_wa('${id(504)}')`);
 const second=JSON.parse(await sql(`${server}select public.claim_whatsapp_review_send('${id(504)}','${id(11)}','${wa.grant.id}')`));
 // Revoked grant cannot authorize an already reserved WA claim.
 await sql(`${prefix(15,26)}select public.admin_revoke_channel_review('${wa.grant.id}')`);
 assert.equal(JSON.parse(await sql(`${prefix()}select public.whatsapp_authorize_review_dispatch('${id(504)}','${second.attempt_token}','${wa.grant.id}')`)).authorized,undefined);
 assert.equal(await sql(`select staff_dispatch_token is null from public.whatsapp_send_intents where id='${id(504)}'`),'t');
 await sql('truncate private.instagram_manual_contracts');
 const nonce='VELORA-REVIEW-offline-sql';const nonceHash=(await import('node:crypto')).createHash('sha256').update(nonce).digest('hex');
 assert.equal(JSON.parse(await sql(`${prefix(15,26)}select public.admin_begin_instagram_review_bootstrap('${id(1)}','1000','1000','${fingerprint}','${nonceHash}')`)).ok,true);
 const bootstrapBatch={rawBodySha256:'c'.repeat(64),localReceivedAt:new Date().toISOString(),events:[{kind:'message',professionalAccountId:'100',senderId:'200',recipientId:'100',messageId:'mid.offline-bootstrap',direction:'inbound',isEcho:null,content:{kind:'text',text:nonce},rawTimestamp:Date.now()-1000}]};
 const observe=body=>sql(`${server}select public.instagram_observe_review_bootstrap('${id(1)}','1000','${fingerprint}',${lit(JSON.stringify(body))}::jsonb)`).then(JSON.parse);
 assert.equal((await observe({...bootstrapBatch,events:[{...bootstrapBatch.events[0],content:{kind:'text',text:'not the challenge'}}]})).status,'retryable');
 assert.equal(await sql('select count(*) from private.instagram_manual_contracts'),'0');
 assert.equal((await observe({...bootstrapBatch,events:[{...bootstrapBatch.events[0],messageId:'mid.signed'}]})).status,'retryable');
 assert.equal(await sql('select count(*) from private.instagram_manual_contracts'),'0');
 assert.equal(await sql('select count(*) from private.instagram_review_bootstrap where observed_at is not null'),'0');
 const sibling={...bootstrapBatch.events[0],messageId:'mid.offline-bootstrap-sibling',content:{kind:'text',text:'second real-shaped message'}};
 assert.equal((await observe({...bootstrapBatch,events:[...bootstrapBatch.events,sibling]})).status,'committed');
 assert.equal(await sql("select count(*) from private.instagram_messages where provider_mid='mid.offline-bootstrap-sibling'"),'1');
 assert.equal(await sql('select timestamp_unit from private.instagram_manual_contracts'),'unix_ms');
 assert.equal(JSON.parse(await sql(`${prefix(15,26)}select public.admin_read_instagram_review_bootstrap('${id(1)}')`)).sender_id,'200');
 console.log('PASS: real IG native claim/window/settlement/projection, separate review proof, untouched billing, WA verified-window requirement and final revocation fence');
}finally{await cleanup();}
