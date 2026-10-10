import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isolatedPostgres,lit } from '../g03-review-acceptance/postgres.mjs';
import { evidence } from './evidence.mjs';
const state=vi.hoisted(()=>({client:null,actor:null}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>state.client}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:async()=>({ok:true,context:state.actor})}));
vi.mock('@/lib/access/actions',()=>({sessionHasCompanyCapability:async()=>true}));
import { readSessionServiceAccess } from '@/lib/services/access';
import { GET } from '@/app/api/company/service-access/route';
let db,f;
const parse=out=>JSON.parse(out.split('\n').find(x=>x.startsWith('{')));
const srv=query=>db.sql(`BEGIN;SET LOCAL ROLE service_role;${query}COMMIT;`);
const call=(name,args)=>`SELECT public.${name}(${args});`;
const cap="'noura.knowledge.read'";
const authenticated=(fixture,query,actor=fixture.actor,session=fixture.session)=>db.sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(actor)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:actor,session_id:session,role:'authenticated'}))};${query}COMMIT;`);
const read=(fixture,capability='noura.knowledge.read',company=fixture.company,actor=fixture.actor,session=fixture.session)=>authenticated(fixture,call('billing_read_service_access',`${lit(company)},${lit(capability)}`),actor,session).then(parse);
async function fixture({environment='live',tier='basic',snapshot=true,publish=true}={}) {
 const x={actor:randomUUID(),session:randomUUID(),company:randomUUID(),plan:randomUUID(),version:randomUUID(),order:randomUUID(),attempt:randomUUID(),providerOrder:randomUUID(),reference:`synthetic_${randomUUID()}`,environment,tier};
 await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(x.actor)},'synthetic@example.invalid',now());INSERT INTO auth.sessions(id,user_id) VALUES(${lit(x.session)},${lit(x.actor)});INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(x.session)},${lit(x.actor)},clock_timestamp());
 INSERT INTO companies(id,display_name,status,created_by) VALUES(${lit(x.company)},'Synthetic service test','active',${lit(x.actor)});INSERT INTO company_members(company_id,user_id,role,status) VALUES(${lit(x.company)},${lit(x.actor)},'owner','active');
 INSERT INTO billing_plans(id,code,name,status) VALUES(${lit(x.plan)},${lit('unrelated_'+randomUUID())},'Synthetic explicit offer','active');INSERT INTO billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status) VALUES(${lit(x.version)},${lit(x.plan)},1,5000,'OMR',30,'day',30,'draft');`);
 expect(parse(await srv(call('billing_define_service_offer',`${lit(x.version)},'noura',${lit(tier)},ARRAY['noura.knowledge.read']`)))).toMatchObject({ok:true});
 if(publish) await db.sql(`UPDATE billing_plan_versions SET status='published' WHERE id=${lit(x.version)};`);
 await db.sql(`INSERT INTO billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider,provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,status,product_code,purchase_purpose,created_by,deadline_policy_approved) VALUES(${lit(x.order)},${lit(x.company)},${lit(x.version)},5000,'OMR',30,'day',30,'paymob','74001',${lit(environment)},5000,'paymob_amount',${lit(x.reference)},${lit(randomUUID())},${lit(randomUUID())},'locked','velora_ai_staff','initial',${lit(x.actor)},true);`);
 if(snapshot) expect(parse(await srv(call('billing_snapshot_service_order',lit(x.order))))).toMatchObject({ok:true,code:'SNAPSHOTTED'});
 await db.sql(`INSERT INTO billing_payment_attempts(id,order_id,company_id,status,provider_order_id) VALUES(${lit(x.attempt)},${lit(x.order)},${lit(x.company)},'provider_submitted',${lit(x.providerOrder)});`);
 return x;
}
async function settle(x) {
 const e=evidence(x,randomUUID()); const payload={...e};delete payload.raw;
 await db.sql(`INSERT INTO billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) VALUES(${lit(x.attempt)},${lit(x.company)},'paymob','74001',${lit(x.environment)},${lit(e.provider_transaction_id)},'success',${lit(e.observation_key)},5000,'OMR',${lit(JSON.stringify(e.raw))}::jsonb);`);
 expect(parse(await srv(call('billing_settle_paymob_hmac_verified',`${lit(JSON.stringify(payload))}::jsonb`)))).toMatchObject({ok:true,outcome:'granted'});
 x.application=await db.sql(`SELECT id FROM billing_entitlement_applications WHERE order_id=${lit(x.order)};`);
 expect(await db.sql(`SELECT count(*) FROM private.billing_proven_entitlement_grants WHERE id=${lit(x.application)};`)).toBe('1');
}
const grant=x=>srv(call('billing_apply_service_grant',lit(x.application))).then(parse);
const activate=(x,value=true)=>srv(call('billing_activate_service_grant',`${lit(x.application)},${value}`)).then(parse);
beforeAll(async()=>{
 db=await isolatedPostgres();await db.bootstrap({throughMigration:'20261008170000_vel_owner_review_scope_read.sql'});
 expect(await db.sql("SELECT to_regprocedure('public.billing_read_service_access(uuid,text)') IS NULL;")).toBe('t');
 await db.sql('ALTER TABLE billing_provider_events DISABLE TRIGGER billing_provider_receipt_immutability;');
 await expect(db.file('supabase/migrations/20261010053446_service_entitlement_read_contract.sql')).rejects.toThrow(/SERVICE_IMMUTABLE_RECEIPT_TRIGGERS_MISSING/);
 expect(await db.sql("SELECT to_regclass('private.billing_service_offers') IS NULL;")).toBe('t');
 await db.sql('ALTER TABLE billing_provider_events ENABLE TRIGGER billing_provider_receipt_immutability;');
 await db.file('supabase/migrations/20261010053446_service_entitlement_read_contract.sql');
 f=await fixture();await settle(f);await grant(f);
 state.actor={userId:f.actor,emailConfirmed:true,needsCompanyContext:false,company:{id:f.company,status:'active'},membership:{company_id:f.company,user_id:f.actor,status:'active',role:'owner'}};
 state.client={rpc:async(name,args)=>{try {return {data:parse(await authenticated(f,call(name,`${lit(args.p_company_id)},${lit(args.p_capability)}`))),error:null};}catch{return {data:null,error:{code:'SQL_FAILED'}};}}};
});
afterAll(async()=>{if(db)await db.close();});
it('requires separate activation even for a proven payment-linked service grant',async()=>{
 expect(await read(f)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});expect(await activate(f)).toMatchObject({ok:true});
 expect(await read(f)).toMatchObject({allowed:true,company_id:f.company,service_code:'noura',tier:'basic',environment:'live',plan_version_id:f.version});
});
it('wires the actual session adapter and HTTP boundary to the PostgreSQL RPC',async()=>{
 expect(await readSessionServiceAccess('noura.knowledge.read')).toMatchObject({allowed:true,service:'noura',tier:'basic'});
 const response=await GET(new Request('https://local/api/company/service-access?capability=noura.knowledge.read&company_id=forged&persona=dana'));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(await response.json()).toMatchObject({allowed:true,service:'noura',tier:'basic'});
});
it('denies anonymous/service reads and authenticated grant or table writes',async()=>{
 for(const role of ['anon','service_role']) await expect(db.sql(`BEGIN;SET LOCAL ROLE ${role};${call('billing_read_service_access',`${lit(f.company)},${cap}`)}COMMIT;`)).rejects.toThrow(/permission denied/);
 for(const fn of [call('billing_define_service_offer',`${lit(f.version)},'noura','premium',ARRAY['noura.knowledge.read']`),call('billing_snapshot_service_order',lit(f.order)),call('billing_apply_service_grant',lit(f.application)),call('billing_activate_service_grant',`${lit(f.application)},true`)]) await expect(authenticated(f,fn)).rejects.toThrow(/permission denied/);
 for(const role of ['authenticated','service_role']) await expect(db.sql(`BEGIN;SET LOCAL ROLE ${role};INSERT INTO private.billing_service_grants(entitlement_application_id,order_id) VALUES(${lit(f.application)},${lit(f.order)});COMMIT;`)).rejects.toThrow(/permission denied/);
});
it('denies forged tenant without revealing grant/plan/tier metadata',async()=>{
 expect(await read(f,'noura.knowledge.read',randomUUID())).toEqual({ok:false,code:'FORBIDDEN'});
 const outsider=randomUUID(),sid=randomUUID();await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(outsider)},'outsider@example.invalid',now());INSERT INTO auth.sessions(id,user_id) VALUES(${lit(sid)},${lit(outsider)});INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(sid)},${lit(outsider)},clock_timestamp());`);
 expect(await read(f,'noura.knowledge.read',f.company,outsider,sid)).toEqual({ok:false,code:'FORBIDDEN'});
});
it('denies wrong service, targets and invented capabilities',async()=>{
 for(const c of ['lina.website.read','dana.reports.read','dana.pos.read','reports.read','all']) expect(await read(f,c)).toEqual({ok:false,code:'UNSUPPORTED_CAPABILITY'});
 expect(parse(await srv(call('billing_define_service_offer',`${lit(f.version)},'dana','premium',ARRAY['dana.reports.read']`)))).toEqual({ok:false,code:'UNSUPPORTED_CAPABILITY'});
});
it('does not authorize Test receipts in the Live read path',async()=>{
 const x=await fixture({environment:'test',tier:'premium'});await settle(x);await grant(x);await activate(x);
 expect(await read(x)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});
});
it('denies an unverified payment application and offers added after dispatch',async()=>{
 expect(parse(await srv(call('billing_apply_service_grant',lit(randomUUID()))))).toEqual({ok:false,code:'PAYMENT_UNPROVEN'});
 const x=await fixture({snapshot:false});await settle(x);
 expect(await grant(x)).toEqual({ok:false,code:'SERVICE_CONTRACT_MISSING'});
 expect(parse(await srv(call('billing_snapshot_service_order',lit(x.order))))).toEqual({ok:false,code:'ORDER_ALREADY_DISPATCHED'});
});
it('keeps explicit offer and order snapshots immutable and does not infer tier from a plan name',async()=>{
 expect(parse(await srv(call('billing_define_service_offer',`${lit(f.version)},'noura','premium',ARRAY['noura.knowledge.read']`)))).toEqual({ok:false,code:'IMMUTABLE'});
 for(const q of [`UPDATE private.billing_service_offers SET tier='premium' WHERE plan_version_id=${lit(f.version)};`,`DELETE FROM private.billing_service_order_offers WHERE order_id=${lit(f.order)};`,`UPDATE private.billing_service_grants SET order_id=${lit(randomUUID())} WHERE entitlement_application_id=${lit(f.application)};`]) await expect(db.sql(q)).rejects.toThrow(/SERVICE_EVIDENCE_IMMUTABLE/);
 expect(await read(f)).toMatchObject({tier:'basic'});
 const x=await fixture({tier:'premium'});await settle(x);await grant(x);await activate(x);expect(await read(x)).toMatchObject({tier:'premium'});
});
it('denies expired/revoked direct sessions even when rollout and pre-request hook are disabled',async()=>{
 await db.sql(`UPDATE private.app_session_settings SET enabled=false;UPDATE private.app_session_activity SET last_activity_at=clock_timestamp()-interval '3 hours' WHERE session_id=${lit(f.session)};`);
 expect(await read(f)).toEqual({ok:false,code:'UNAUTHENTICATED'});
 await db.sql(`UPDATE private.app_session_activity SET last_activity_at=clock_timestamp(),expired_at=null WHERE session_id=${lit(f.session)};`);
 expect(await read(f,'noura.knowledge.read',f.company,f.actor,randomUUID())).toEqual({ok:false,code:'UNAUTHENTICATED'});
 await db.sql(`UPDATE private.app_session_settings SET enabled=true;`);
 expect(await read(f)).toMatchObject({allowed:true});
});
it('denies disabled membership and RBAC without exposing metadata',async()=>{
 await db.sql(`UPDATE company_members SET status='disabled' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.actor)};`);
 expect(await read(f)).toEqual({ok:false,code:'FORBIDDEN'});
 await db.sql(`UPDATE company_members SET status='active',role='staff' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.actor)};`);
 expect(await read(f)).toEqual({ok:false,code:'FORBIDDEN'});
 await db.sql(`UPDATE company_members SET role='owner' WHERE company_id=${lit(f.company)} AND user_id=${lit(f.actor)};`);
});
it('denies revoked receipt and deactivation without deleting financial history or restoring a revoked receipt',async()=>{
 await activate(f,false);expect(await read(f)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});await activate(f);
 await db.sql(`UPDATE billing_entitlement_applications SET status='revoked' WHERE id=${lit(f.application)};`);
 expect(await read(f)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});
 expect(await db.sql(`SELECT count(*) FROM billing_entitlement_applications WHERE id=${lit(f.application)};`)).toBe('1');
 expect(await grant(f)).toEqual({ok:false,code:'PAYMENT_UNPROVEN'});
 expect(await activate(f)).toEqual({ok:false,code:'SUBSCRIPTION_INACTIVE'});
 await expect(db.sql(`UPDATE billing_entitlement_applications SET status='active' WHERE id=${lit(f.application)};`)).rejects.toThrow(/BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE/);
});
it('denies an originally expired payment-linked receipt even with historical activation',async()=>{
 // Original INSERT-only historical synthetic evidence. Never rewrite receipt times
 // or disable financial guards to emulate time passing.
 const x=await fixture(),sid=randomUUID(),event=randomUUID(),gid=randomUUID(),tx=randomUUID();x.application=gid;
 await db.sql(`INSERT INTO billing_subscriptions(id,company_id,plan_version_id,status,paid_through,environment) VALUES(${lit(sid)},${lit(x.company)},${lit(x.version)},'active',clock_timestamp()-interval '1 day','live');
 INSERT INTO billing_provider_events SELECT (jsonb_populate_record(null::billing_provider_events,to_jsonb(e)||jsonb_build_object('id',${lit(event)},'company_id',${lit(x.company)},'payment_attempt_id',${lit(x.attempt)},'provider_transaction_id',${lit(tx)},'observation_key',${lit(tx)},'raw_summary',e.raw_summary||jsonb_build_object('provider_transaction_id',${lit(tx)},'provider_order_id',${lit(x.providerOrder)})))).* FROM billing_provider_events e JOIN billing_entitlement_applications g ON g.provider_event_id=e.id WHERE g.id=${lit(f.application)};
 UPDATE billing_orders SET status='closed' WHERE id=${lit(x.order)};UPDATE billing_payment_attempts SET status='paid' WHERE id=${lit(x.attempt)};
 INSERT INTO billing_entitlement_applications SELECT (jsonb_populate_record(null::billing_entitlement_applications,to_jsonb(g)||jsonb_build_object('id',${lit(gid)},'company_id',${lit(x.company)},'order_id',${lit(x.order)},'subscription_id',${lit(sid)},'payment_attempt_id',${lit(x.attempt)},'provider_event_id',${lit(event)},'provider_transaction_id',${lit(tx)},'status','active','applied_paid_through',(select paid_through from billing_subscriptions where id=${lit(sid)})))).* FROM billing_entitlement_applications g WHERE g.id=${lit(f.application)};
 INSERT INTO billing_settlement_outcomes SELECT (jsonb_populate_record(null::billing_settlement_outcomes,to_jsonb(o)||jsonb_build_object('id',${lit(randomUUID())},'company_id',${lit(x.company)},'order_id',${lit(x.order)},'payment_attempt_id',${lit(x.attempt)},'provider_event_id',${lit(event)},'provider_transaction_id',${lit(tx)},'entitlement_application_id',${lit(gid)},'applied_paid_through',(select paid_through from billing_subscriptions where id=${lit(sid)})))).* FROM billing_settlement_outcomes o WHERE o.entitlement_application_id=${lit(f.application)} AND o.outcome='granted';`);
 expect(await db.sql(`SELECT count(*) FROM private.billing_proven_entitlement_grants WHERE id=${lit(gid)};`)).toBe('1');
 expect(await grant(x)).toMatchObject({ok:true});expect(await activate(x)).toEqual({ok:false,code:'SUBSCRIPTION_INACTIVE'});
 // Simulate originally activated historical state using test-owner fixture DML.
 // App/service roles lack this direct update privilege.
 await db.sql(`UPDATE private.billing_service_grants SET activated=true WHERE entitlement_application_id=${lit(gid)};`);
 expect(await read(x)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});
});
it('denies a pending known refund before lifecycle processing changes the original receipt',async()=>{
 const x=await fixture();await settle(x);await grant(x);await activate(x);expect(await read(x)).toMatchObject({allowed:true});
 await db.sql(`INSERT INTO billing_provider_events SELECT (jsonb_populate_record(null::billing_provider_events,to_jsonb(e)||jsonb_build_object('id',${lit(randomUUID())},'observation_key',${lit(randomUUID())},'event_status','other','raw_summary',e.raw_summary||jsonb_build_object('is_refunded',true)))).* FROM billing_provider_events e JOIN billing_entitlement_applications g ON g.provider_event_id=e.id WHERE g.id=${lit(x.application)};`);
 expect(await read(x)).toEqual({ok:false,code:'SERVICE_NOT_ACTIVE'});expect(await activate(x)).toEqual({ok:false,code:'SUBSCRIPTION_INACTIVE'});
 expect(await db.sql(`SELECT status FROM billing_entitlement_applications WHERE id=${lit(x.application)};`)).toBe('active');
});
it('denies an actually deleted auth session without relying on rollout settings',async()=>{
 const x=await fixture();await settle(x);await grant(x);await activate(x);await db.sql(`UPDATE private.app_session_settings SET enabled=false;DELETE FROM auth.sessions WHERE id=${lit(x.session)};`);
 expect(await read(x)).toEqual({ok:false,code:'UNAUTHENTICATED'});
});
it('honors verified phone identity and authoritative staff grants under the existing identity policy',async()=>{
 const x=await fixture();await settle(x);await grant(x);await activate(x);
 await db.sql(`UPDATE auth.users SET email_confirmed_at=null,phone_confirmed_at=now() WHERE id=${lit(x.actor)};UPDATE company_members SET role='staff' WHERE company_id=${lit(x.company)} AND user_id=${lit(x.actor)};INSERT INTO company_member_grants(company_id,user_id,capabilities,status) VALUES(${lit(x.company)},${lit(x.actor)},ARRAY['knowledge.read'],'active');`);
 expect(await read(x)).toMatchObject({allowed:true});await db.sql(`UPDATE company_member_grants SET status='disabled' WHERE company_id=${lit(x.company)} AND user_id=${lit(x.actor)};`);expect(await read(x)).toEqual({ok:false,code:'FORBIDDEN'});
});
async function activity(name,predicate){for(let n=0;n<60;n++){const r=JSON.parse(await db.sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'wait',wait_event,'type',wait_event_type)),'[]') FROM pg_stat_activity WHERE application_name=${lit(name)};`));if(r.some(predicate))return r[0];await new Promise(r=>setTimeout(r,50));}throw Error('PG_BARRIER_NOT_OBSERVED');}
it('serializes concurrent duplicate grants across real PostgreSQL sessions with observed row lock',async()=>{
 const x=await fixture();await settle(x);const suffix=randomUUID().slice(0,8),aName=`service_a_${suffix}`,bName=`service_b_${suffix}`;
 const a=db.session(`BEGIN;SELECT 1 FROM companies WHERE id=${lit(x.company)} FOR UPDATE;SELECT pg_sleep(4);SET LOCAL ROLE service_role;${call('billing_apply_service_grant',lit(x.application))}COMMIT;`,aName);
 const first=await activity(aName,r=>r.wait==='PgSleep');
 const b=db.session(`BEGIN;SET LOCAL ROLE service_role;${call('billing_apply_service_grant',lit(x.application))}COMMIT;`,bName);
 const second=await activity(bName,r=>r.type==='Lock');expect(first.pid).not.toBe(second.pid);
 console.log('PG_SERVICE_LOCK_EVIDENCE',JSON.stringify({blocker:first,waiter:second}));
 expect(parse(await a.done)).toMatchObject({ok:true,code:'GRANTED'});expect(parse(await b.done)).toMatchObject({ok:true,code:'IDEMPOTENT_REPLAY'});
 expect(await db.sql(`SELECT count(*) FROM private.billing_service_grants WHERE order_id=${lit(x.order)};`)).toBe('1');
});
