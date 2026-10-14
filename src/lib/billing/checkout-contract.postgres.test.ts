import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
// @ts-expect-error guarded disposable local Docker Postgres; never a remote DB
import {bootstrap,sql,file,cleanup} from '../../../scripts/instagram-connection/postgres.mjs';
const company='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',version='44444444-4444-4444-8444-444444444444';
const server="set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
vi.setConfig({testTimeout:30000,hookTimeout:90000}); // Docker process overhead; each real SQL statement keeps its 15-second guard.
function nativeSource(source:string,name:string){const body=readFileSync(source,'utf8');const start=new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\(').exec(body)?.index;if(start===undefined)throw Error('NATIVE_MISSING '+name);return body.slice(start,body.indexOf('$$;',start)+3);}
beforeAll(async()=>{
 await bootstrap('scripts/master-checkout/dependencies.sql');
 await sql(readdirSync('supabase/migrations').filter(n=>n>='20261006180000'&&n<='20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql'&&(/billing|paymob|subscription/.test(n)||n<'20261007010001')).sort().map(name=>readFileSync('supabase/migrations/'+name,'utf8')).join('\n'));
 await file('scripts/master-checkout/live-dependencies.sql');
 await sql(['private.billing_live_owner','public.billing_create_live_checkout_order','public.billing_claim_live_checkout','public.billing_complete_live_checkout'].map(name=>nativeSource('supabase/upgrade-packages/paymob-live-checkout/20-production-compatibility.review.sql',name)).join('\n'));
 const history=readFileSync('supabase/migrations/20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql','utf8');
 await sql(['private.billing_verified_collection_history','private.billing_proven_entitlement_grants'].map(name=>{const start=history.indexOf('create view '+name+' as');return history.slice(start,history.indexOf('\nrevoke',start));}).join('\n')+nativeSource('supabase/migrations/20261010053446_service_entitlement_read_contract.sql','private.billing_service_receipt_eligible'));
 const activationSource='supabase/migrations/20261014033001_master_subscription_activation.sql';const activation=readFileSync(activationSource,'utf8');
 await sql(activation.slice(activation.indexOf('begin;'),activation.indexOf('create function private.master_activation_setup_destroyed'))+'commit;');
 await sql('drop function private.master_activation_company_end(uuid);drop function private.master_activation_waiting(uuid);create function private.master_activation_ready(uuid,uuid) returns boolean language sql as $$select false$$;'); // Offline channel-readiness port, never provider evidence.
 await sql(['private.master_activation_receipt_current','private.master_activation_receipt_state','private.master_activation_effective_end','private.master_reconcile_activation_locked','public.master_capture_subscription_activation','private.master_activation_company_end','private.master_activation_waiting'].map(name=>nativeSource(activationSource,name)).join('\n'));
 await sql(`do $$declare f record;begin for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'master_%activation%' loop execute format('alter function %s set jit=off',f.oid::regprocedure);end loop;end;$$;`); // Match the actual C migration configuration.
 await file('supabase/migrations/20261014033003_master_checkout_contract.sql');
 await file('supabase/migrations/20261014033006_master_native_upgrade.sql');
 await sql(`insert into auth.users(id,email,email_confirmed_at) values('${user}','offline@example.invalid',clock_timestamp());insert into auth.sessions(id,user_id) values('${user}','${user}');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${user}','${user}',clock_timestamp());insert into public.companies(id,display_name,status) values('${company}','Offline','active');insert into public.company_members(company_id,user_id,role,status) values('${company}','${user}','owner','active');insert into public.billing_plans(id,code,name,status) values('${version}','offline','Offline','active');insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits) values('${version}','${version}',1,45000,'OMR',30,'month',1,'draft','{"automated_outbound_per_month":500}');update public.billing_plan_versions set status='published';insert into private.billing_service_offers values('${version}','noura','basic',array['noura.knowledge.read']);insert into private.ai_plan_budget_policies values('${version}',5000);insert into private.billing_live_merchant_contracts values('${version}',71610,'1001',1000,'OMR',true,clock_timestamp());`);
},90000);
afterAll(cleanup);
const create=(op:string)=>sql(server+`select public.billing_create_live_checkout_order('${company}','${user}','${user}','${version}','${op}',1,71610,'1001',1000)`).then(JSON.parse);
let order:string,attempt:string;
it('approved terms are unconfigured by default and no native order is allocated',async()=>{expect(await create('no-terms')).toMatchObject({ok:false,code:'CHECKOUT_TERMS_UNCONFIGURED'});expect(await sql('select count(*) from public.billing_orders')).toBe('0');});
it('native quote has an immutable 15-minute snapshot and explicit consent gates provider claim',async()=>{
 await sql(`insert into private.master_checkout_terms(plan_version_id,terms_version,terms_text,features_version,features,disclosed_charges,approval_reference) values('${version}','OFFLINE-TERMS-1','Offline provider-double terms: zero fixture charges','OFFLINE-FEATURES-1','["offline feature"]','[]','offline-fixture-only')`);
 const r=await create('quote');expect(r.ok).toBe(true);order=r.order_id;attempt=r.payment_attempt_id;
 expect(await sql(`select extract(epoch from(quote_expires_at-quoted_at))::integer from private.master_checkout_quotes where order_id='${order}'`)).toBe('900');
 expect(await sql(server+`select public.billing_claim_live_checkout('${company}','${order}','${attempt}','${user}','${user}')`).then(JSON.parse)).toMatchObject({kind:'rejected',code:'CHECKOUT_CONSENT_REQUIRED'});
 await expect(sql(`update private.master_checkout_quotes set snapshot='{}' where order_id='${order}'`)).rejects.toThrow(/CHECKOUT_IMMUTABLE/);
 await expect(sql(`update public.billing_orders set expires_at=expires_at+interval '15 minutes' where id='${order}'`)).rejects.toThrow(/CHECKOUT_IMMUTABLE/);
});
it('consent must identify the exact terms and verified owner; replay records only one agreement',async()=>{
 const consent=(actor:string,terms:string)=>sql(server+`select public.master_accept_checkout_consent('${company}','${order}','${actor}','${user}','${terms}',true)`).then(JSON.parse);
 expect(await consent(version,'OFFLINE-TERMS-1')).toMatchObject({ok:false,code:'FORBIDDEN'});expect(await consent(user,'wrong')).toMatchObject({ok:false,code:'CHECKOUT_TERMS_CHANGED'});
 expect(await consent(user,'OFFLINE-TERMS-1')).toMatchObject({ok:true});expect(await consent(user,'OFFLINE-TERMS-1')).toMatchObject({ok:true});expect(await sql('select count(*) from private.master_checkout_consents')).toBe('1');
});
it('unresolved attempt survives expiry and a late provider response is persisted without another charge',async()=>{
 expect(await sql(server+`select public.billing_claim_live_checkout('${company}','${order}','${attempt}','${user}','${user}')`).then(JSON.parse)).toMatchObject({kind:'claimed'});
 // Expire clock in this isolated fixture only; production immutability stays enforced.
 await sql(`alter table public.billing_orders disable trigger master_checkout_order_immutable;alter table private.master_checkout_quotes disable trigger master_checkout_quote_immutable;update public.billing_orders set expires_at=clock_timestamp()-interval '1 second' where id='${order}';update private.master_checkout_quotes set quoted_at=(select expires_at-interval '15 minutes' from public.billing_orders where id='${order}'),quote_expires_at=(select expires_at from public.billing_orders where id='${order}') where order_id='${order}';alter table public.billing_orders enable trigger master_checkout_order_immutable;alter table private.master_checkout_quotes enable trigger master_checkout_quote_immutable;`);
 expect(await sql(server+`select public.billing_claim_live_checkout('${company}','${order}','${attempt}','${user}','${user}')`).then(JSON.parse)).toMatchObject({kind:'pending'});
 expect(await create('new-order')).toMatchObject({ok:false,code:'LIVE_COLLECTION_REQUIRES_RECONCILIATION'});
 expect(await sql(server+`select public.billing_complete_live_checkout('${company}','${order}','${attempt}','${user}','${user}','98001','https://om.checkout.paymob.com/?publicKey=pk_live_offline&clientSecret=offline','offline')`)).toBe('t');
 expect(await sql('select count(*) from public.billing_payment_attempts')).toBe('1');expect(await sql('select status from public.billing_payment_attempts')).toBe('provider_submitted');
});
it('manual renewal is denied before native paid-through even when activation rollout is off',async()=>{
 await sql(`insert into public.billing_subscriptions(company_id,environment,status,paid_through) values('${company}','live','active',clock_timestamp()+interval '1 day') on conflict(company_id,environment) do update set status='active',paid_through=clock_timestamp()+interval '1 day'`);
 expect(await sql(server+`select public.billing_create_or_reuse_subscription_order('${company}','velora_ai_staff','renew','${version}','${version}','early-renewal','offline','offline-renew',45000,'OMR',30,'month',1,'71610','live','${user}')`).then(JSON.parse)).toMatchObject({ok:false,code:'SUBSCRIPTION_CYCLE_NOT_ENDED'});
});
it('direct retry cannot bypass expired quote, owner or unresolved financial evidence',async()=>{
 await expect(sql(server+`select public.billing_open_payment_attempt_after_confirmed_failed('${order}','${company}','${attempt}','retry-1')`)).rejects.toThrow(/CHECKOUT_QUOTE_EXPIRED|unresolved|confirmed failed/);
 await expect(sql(`set role authenticated;select public.master_accept_checkout_consent('${company}','${order}','${user}','${user}','OFFLINE-TERMS-1',true)`)).rejects.toThrow(/permission denied/);
});
it('native upgrade allocation fails closed without a proven original basic cycle',async()=>{
 expect(await sql(server+`select public.billing_create_or_reuse_subscription_order('${company}','velora_ai_staff','upgrade','${version}','${version}','upgrade','offline','offline-upgrade',45000,'OMR',30,'month',1,'71610','live','${user}')`).then(JSON.parse)).toMatchObject({ok:false,code:'UPGRADE_NOT_AVAILABLE'});
});
it('native 45OMR upgrade preserves the original financial cycle and replays exactly once (offline provider evidence double)',async()=>{
 const evidence=(oid:string,aid:string,txn:string,reference:string,providerOrder:string)=>JSON.stringify({company_id:company,order_id:oid,payment_attempt_id:aid,provider:'paymob',provider_account_ref:'71610',provider_environment:'live',provider_transaction_id:txn,special_reference:reference,currency_expected:'OMR',event_status:'success',amount_baisa:45000,evidence_marker:'VEL_PAYMOB_SERVER_HMAC_VERIFIED',hmac_verified:true,signed_owner:'1001',integration_id:71610,amount_cents:45000,provider_order_id:providerOrder,currency:'OMR',pending:false,success:true,error_occured:false,is_auth:false,is_capture:false,is_refunded:false,is_voided:false,has_parent_transaction:false,is_standalone_payment:true});
 const settle=(e:string)=>sql(server+`select public.billing_settle_paymob_hmac_verified('${e.replaceAll("'","''")}')`).then(JSON.parse);
 const reference=await sql(`select special_reference from public.billing_orders where id='${order}'`);
 const original=await settle(evidence(order,attempt,'offline-original',reference,'98001'));expect(original.outcome).toBe('granted');
 const end=await sql(`select paid_through from public.billing_subscriptions where company_id='${company}'`);
 await sql(`insert into private.master_subscription_activation(receipt_id,company_id,subscription_id,plan_version_id,payment_confirmed_at,entitlement_created_at,activation_deadline,subscription_started_at,expires_at,receipt_paid_through,bonus_days,start_reason) select id,company_id,subscription_id,'${version}',applied_at,applied_at,applied_at+interval '14 days',applied_at,applied_at+interval '37 days',applied_paid_through,7,'ready' from public.billing_entitlement_applications where id='${original.entitlement_application_id}';update private.master_activation_policy set enabled=true,enabled_at=clock_timestamp()-interval '1 day',approval_reference='OFFLINE-ACTIVATION';`);
 const effectiveEnd=await sql(`select private.master_activation_effective_end('${original.entitlement_application_id}')`);
 await sql(`update public.billing_subscriptions set cancel_at_period_end=true where company_id='${company}'`);
 const premium='55555555-5555-4555-8555-555555555555';
 await sql(`insert into public.billing_plans(id,code,name,status) values('${premium}','offline_premium','Offline premium','active');insert into public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits) values('${premium}','${premium}',1,90000,'OMR',30,'month',1,'draft','{"automated_outbound_per_month":1500}');update public.billing_plan_versions set status='published' where id='${premium}';insert into private.billing_service_offers values('${premium}','noura','premium',array['noura.knowledge.read']);insert into private.ai_plan_budget_policies values('${premium}',10000);insert into private.master_checkout_terms values('${premium}','OFFLINE-PREMIUM','Offline premium terms','OFFLINE-PREMIUM','["offline premium"]','[]','offline-only',clock_timestamp());`);
 const up=await sql(server+`select public.billing_create_live_upgrade_order('${company}','${user}','${user}','${premium}','upgrade',1,71610,'1001',1000)`).then(JSON.parse);expect(up.ok).toBe(true);
 expect(await sql(`select amount_baisa from public.billing_orders where id='${up.order_id}'`)).toBe('45000');
 expect(await sql(server+`select public.master_accept_checkout_consent('${company}','${up.order_id}','${user}','${user}','OFFLINE-PREMIUM',true)`).then(JSON.parse)).toMatchObject({ok:true});
 expect(await sql(server+`select public.billing_claim_live_checkout('${company}','${up.order_id}','${up.payment_attempt_id}','${user}','${user}')`).then(JSON.parse)).toMatchObject({kind:'claimed'});
 expect(await sql(server+`select public.billing_complete_live_checkout('${company}','${up.order_id}','${up.payment_attempt_id}','${user}','${user}','98002','https://om.checkout.paymob.com/?publicKey=pk_live_offline&clientSecret=upgrade','offline-upgrade')`)).toBe('t');
 const e=evidence(up.order_id,up.payment_attempt_id,'offline-upgrade',up.special_reference,'98002');
 await sql(`create or replace function public.master_apply_cycle_upgrade(p_company_id uuid,p_receipt_id uuid) returns jsonb language sql as $$select '{"ok":false,"code":"OFFLINE_CREDIT_FAILURE"}'::jsonb$$`);
 await expect(settle(e)).rejects.toThrow(/UPGRADE_CREDIT_APPLY_FAILED/);expect(await sql(`select count(*) from public.billing_entitlement_applications where order_id='${up.order_id}'`)).toBe('0');
 await sql(`create or replace function public.master_apply_cycle_upgrade(p_company_id uuid,p_receipt_id uuid) returns jsonb language plpgsql as $$begin insert into private.fixture_upgrade_credit_calls values(p_receipt_id) on conflict do nothing;return '{"ok":true}'::jsonb;end;$$`);
 const paid=await settle(e);expect(paid.outcome).toBe('granted');expect((await settle(e)).outcome).toBe('idempotent_replay');expect(await sql('select count(*) from private.fixture_upgrade_credit_calls')).toBe('1');
 expect(await sql(`select paid_through from public.billing_subscriptions where company_id='${company}'`)).toBe(end);expect(await sql(`select plan_version_id from public.billing_subscriptions where company_id='${company}'`)).toBe(premium);
 expect(await sql(`select cancel_at_period_end from public.billing_subscriptions where company_id='${company}'`)).toBe('t');
 expect(await sql(`select cycle_receipt_id from private.master_checkout_upgrades where order_id='${up.order_id}'`)).toBe(original.entitlement_application_id);
 expect(await sql(`select count(*) from private.billing_proven_entitlement_grants where order_id='${up.order_id}'`)).toBe('1');
 expect(await sql(`select private.master_activation_effective_end('${paid.entitlement_application_id}')`)).toBe(effectiveEnd);
 expect(await sql(`select private.master_activation_receipt_current('${original.entitlement_application_id}')`)).toBe('t');
 expect(await sql(server+`select public.master_capture_subscription_activation('${company}','${paid.entitlement_application_id}')`).then(JSON.parse)).toMatchObject({ok:true,data:{bonusDays:7,expiresAt:expect.any(String)}});
 expect(await sql('select count(*) from private.master_subscription_activation')).toBe('1');expect(await sql('select bonus_days from private.master_subscription_activation')).toBe('7');
},90000);
it('concurrent native retries after confirmed failure reuse one successor and preserve original quote deadline',async()=>{
 const retryOrder=await sql(`insert into public.billing_orders(company_id,plan_version_id,product_code,purchase_purpose,amount_baisa,currency,period_days,period_unit,period_count,provider_account_ref,provider_environment,special_reference,client_op_id,input_fingerprint,created_by) values('${company}','${version}','velora_ai_staff','initial',45000,'OMR',30,'month',1,'71610','live','offline-retry','offline-retry','offline-retry','${user}') returning id`);
 const prior=await sql(`insert into public.billing_payment_attempts(order_id,company_id,attempt_seq) values('${retryOrder}','${company}',1) returning id`);
 const event=await sql(`insert into public.billing_provider_events(payment_attempt_id,provider_account_ref,provider_environment,provider_transaction_id,event_status,company_id) values('${prior}','71610','live','offline-declined','failed','${company}') returning id`);
 expect(await sql(server+`select public.billing_confirm_payment_attempt_failed('${prior}','${company}','{"provider_event_id":"${event}"}')`).then(JSON.parse)).toMatchObject({ok:true});
 const deadline=await sql(`select expires_at from public.billing_orders where id='${retryOrder}'`);
 const retry=()=>sql(server+`select public.billing_open_payment_attempt_after_confirmed_failed('${retryOrder}','${company}','${prior}','same-retry-operation')`).then(JSON.parse);
 const [a,b]=await Promise.all([retry(),retry()]);expect(a.payment_attempt_id).toBe(b.payment_attempt_id);expect(a.payment_attempt_id).not.toBe(prior);
 expect(await sql(`select count(*) from public.billing_payment_attempts where order_id='${retryOrder}'`)).toBe('2');expect(await sql(`select expires_at from public.billing_orders where id='${retryOrder}'`)).toBe(deadline);
},30000);
