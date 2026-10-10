import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {isolatedPostgres,lit} from '../g03-review-acceptance/postgres.mjs';
import {metadata,replay} from './fixture-replay.mjs';
import {fixture,json,service} from './fixtures.mjs';
import {actor,checkout,manualOrder,storedEvent,settle} from './stage2a-fixtures.mjs';
const directory='supabase/upgrade-packages/financial-proof-cloud-stage2a/';
let db,legacy,legacyBefore,budgetBefore,preBound,preActor;
const previous=JSON.parse(readFileSync('supabase/upgrade-packages/financial-proof-cloud/manifest.json','utf8'));
const original=readFileSync('supabase/upgrade-packages/financial-proof-cloud/preflight.readonly.sql','utf8');
const signatures=[...new Set([...Object.keys(previous.functions),...previous.fixture_dependencies.map(f=>f.signature),'private.billing_financial_receipt_immutability()','public.billing_create_test_checkout_order(jsonb,integer)'])];
const query=original.replace(/where p.oid in\(.*?\)\)\) select/s,'where p.oid in('+signatures.map(s=>'to_regprocedure('+lit(s)+')').join(',')+')) select');
const install=()=>db.sql('SET ROLE postgres;'+readFileSync(directory+'10-stage2a.review.sql','utf8'));
beforeAll(async()=>{
 db=await isolatedPostgres();await replay(db,metadata());
 await db.sql('ALTER DATABASE g03_review OWNER TO postgres;REVOKE ALL ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role,postgres,pg_database_owner;GRANT USAGE ON SCHEMA public TO PUBLIC,anon,authenticated,service_role,postgres;GRANT USAGE,CREATE ON SCHEMA public TO pg_database_owner;');
 legacy=await fixture(db);
 await db.sql('ALTER FUNCTION public.billing_create_test_checkout_order(jsonb,integer) OWNER TO postgres;REVOKE ALL ON FUNCTION public.billing_create_test_checkout_order(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.billing_create_test_checkout_order(jsonb,integer) TO service_role;');
 await db.sql('SET ROLE postgres;'+readFileSync('supabase/upgrade-packages/financial-proof-cloud/10-stage1.review.sql','utf8'));
 preActor=await actor(db);preBound=await checkout(db,preActor);expect(preBound.ok).toBe(true);await db.sql('UPDATE public.billing_payment_attempts SET provider=\'paymob\',provider_account_ref='+lit(preActor.account)+',provider_environment=\'test\',provider_order_id=\'synthetic-prebound\' WHERE id='+lit(preBound.payment_attempt_id));
 legacyBefore=JSON.parse(await snapshotLegacy());budgetBefore=await budgets();
 const m=json(await db.sql(query));expect(m.functions.length).toBe(signatures.length);
 expect(m.functions.find(f=>f.signature==='private.billing_financial_receipt_immutability()').body_md5).toBe(previous.package_guard_body_md5);
 const expected=JSON.parse(readFileSync(directory+'manifest.json','utf8')).baseline_live_functions;for(const f of expected)expect(m.functions.find(x=>x.signature===f.signature)).toEqual(f);
 m.views=JSON.parse(await db.sql("BEGIN READ ONLY;SET LOCAL search_path='';SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),'definition_md5',md5(replace(pg_get_viewdef(c.oid,true),chr(13),'')),'acl',(SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN ('billing_verified_collection_history','billing_proven_entitlement_grants');COMMIT;"));
 writeFileSync(process.env.VELORA_STAGE2_BASELINE,JSON.stringify(m),'utf8');

});
afterAll(async()=>{if(db)await db.close();});
async function budgets(){return db.sql("SELECT jsonb_build_object('budget',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_budget_accounts x),'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_usage_ledger x));");}
async function snapshotLegacy(){
 const names=Object.keys(previous.tables);
 const parts=names.map(name=>lit(name)+",(SELECT jsonb_agg(to_jsonb(x)-'{environment,expires_at,deadline_policy_approved}'::text[] ORDER BY id) FROM "+name+" x WHERE "+(legacyBefore?"id IN ("+legacyBefore[name].map(x=>lit(x.id)).join(',')+")":name.endsWith('billing_plan_versions')?'id='+lit(legacy.version):'company_id='+lit(legacy.company))+")");
 return db.sql('SELECT jsonb_build_object('+parts.join(',')+');');
}
const cte=query.slice(query.indexOf('with targets'),query.indexOf("select jsonb_build_object('project'"));
const fingerprints=()=>db.sql("BEGIN READ ONLY;SET LOCAL search_path='';"+cte+"select jsonb_build_object('tables',(select jsonb_object_agg(name,md5(to_jsonb(t)::text)) from t),'functions',(select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) from f));COMMIT;").then(json);
it('proves partial arbiter ON CONFLICT inference preserves duplicate unknown legacy environments',async()=>{
 const r=json(await db.sql("BEGIN;CREATE TEMP TABLE stage2a_arbiter(company_id uuid,environment text);CREATE UNIQUE INDEX stage2a_probe_unique ON stage2a_arbiter(company_id,environment) WHERE environment IN ('test','live');INSERT INTO stage2a_arbiter VALUES(md5('synthetic-company')::uuid,NULL),(md5('synthetic-company')::uuid,NULL);INSERT INTO stage2a_arbiter VALUES(md5('synthetic-company')::uuid,'test') ON CONFLICT(company_id,environment) WHERE environment IN ('test','live') DO NOTHING;INSERT INTO stage2a_arbiter VALUES(md5('synthetic-company')::uuid,'test') ON CONFLICT(company_id,environment) WHERE environment IN ('test','live') DO NOTHING;INSERT INTO stage2a_arbiter VALUES(md5('synthetic-company')::uuid,'live') ON CONFLICT(company_id,environment) WHERE environment IN ('test','live') DO NOTHING;SELECT jsonb_build_object('unknown',count(*) FILTER(WHERE environment IS NULL),'test',count(*) FILTER(WHERE environment='test'),'live',count(*) FILTER(WHERE environment='live')) FROM stage2a_arbiter;ROLLBACK;"));expect(r).toEqual({unknown:2,test:1,live:1});
});
it('rejects partial/conflicting/duplicate prospective attempt scope before DDL without repairing rows',async()=>{
 const f1=await actor(db),f2=await actor(db),r1=await checkout(db,f1),r2=await checkout(db,f2);
 const ids=[r1.payment_attempt_id,r2.payment_attempt_id].map(lit).join(',');
 await db.sql('UPDATE public.billing_payment_attempts SET provider=\'paymob\' WHERE id='+lit(r1.payment_attempt_id));
 await expect(install()).rejects.toThrow(/STAGE2A_PARTIAL_LEGACY_SCOPE/);
 await db.sql('UPDATE public.billing_payment_attempts SET provider_account_ref=\'wrong\',provider_environment=\'test\' WHERE id='+lit(r1.payment_attempt_id));
 await expect(install()).rejects.toThrow(/STAGE2A_EXISTING_SCOPE_CONFLICT/);
 await db.sql('UPDATE public.billing_payment_attempts SET provider=\'paymob\',provider_account_ref=\'74001\',provider_environment=\'test\',provider_order_id=\'synthetic-duplicate\' WHERE id IN ('+ids+');');
 await expect(install()).rejects.toThrow(/STAGE2A_DUPLICATE_BOUND_PROVIDER_ORDER/);
 expect(await db.sql('SELECT count(*) FROM public.billing_payment_attempts WHERE id IN ('+ids+') AND provider_order_id=\'synthetic-duplicate\'')).toBe('2');
 await db.sql('UPDATE public.billing_payment_attempts SET provider=NULL,provider_account_ref=NULL,provider_environment=NULL WHERE id='+lit(r2.payment_attempt_id));
 await expect(install()).rejects.toThrow(/STAGE2A_BOUND_LEGACY_ID_AMBIGUOUS/);
 await db.sql('UPDATE public.billing_payment_attempts SET provider=NULL,provider_account_ref=NULL,provider_environment=NULL WHERE id IN ('+ids+');');
});
it('rolls back installation interruption and rejects metadata drift atomically',async()=>{
 const expected=await fingerprints();
 const sql=readFileSync(directory+'10-stage2a.review.sql','utf8').replace(/commit;\s*$/i,"DO $$BEGIN RAISE EXCEPTION 'SYNTHETIC_INTERRUPTION';END;$$;COMMIT;");
 await expect(db.sql('SET ROLE postgres;'+sql)).rejects.toThrow(/SYNTHETIC_INTERRUPTION/);expect(await fingerprints()).toEqual(expected);
 await db.sql("ALTER TABLE public.billing_payment_attempts ALTER provider SET DEFAULT 'paymob';");await expect(install()).rejects.toThrow(/STAGE2A_CATALOG_PREREQUISITE_MISMATCH/);await db.sql('ALTER TABLE public.billing_payment_attempts ALTER provider DROP DEFAULT;');
 await db.sql('ALTER FUNCTION public.billing_create_test_checkout_order(jsonb,integer) OWNER TO supabase_admin;');await expect(install()).rejects.toThrow(/STAGE2A_CATALOG_PREREQUISITE_MISMATCH/);await db.sql('ALTER FUNCTION public.billing_create_test_checkout_order(jsonb,integer) OWNER TO postgres;');
 expect(await fingerprints()).toEqual(expected);expect(JSON.parse(await snapshotLegacy())).toEqual(legacyBefore);
});
it('fails bounded DDL lock without partial installation',async()=>{
 await db.verify();const h=db.session("BEGIN;LOCK public.billing_payment_attempts IN ROW EXCLUSIVE MODE;SELECT 'STAGE2A_LOCK_READY';",'stage2a-lock',{keepOpen:true});
 try{const start=Date.now();while(!h.output().includes('STAGE2A_LOCK_READY')){if(Date.now()-start>5000)throw Error('LOCK_NOT_READY');await new Promise(r=>setTimeout(r,50));}await expect(install()).rejects.toThrow(/lock timeout/);}finally{h.child.stdin.end('ROLLBACK;\n');await h.done;}
 expect(await budgets()).toBe(budgetBefore);
});
it('installs without rewriting legacy financial rows, budgets, ACLs, product index or Test checkout',async()=>{
 await install();expect(JSON.parse(await snapshotLegacy())).toEqual(legacyBefore);expect(await budgets()).toBe(budgetBefore);
 const after=json(await db.sql(query)),m=metadata();for(const t of m.tables){const a=after.tables.find(x=>x.name===t.name);expect(a.acl).toEqual(t.acl);expect(a.column_acl).toEqual(t.column_acl);}
 const live=JSON.parse(readFileSync(directory+'manifest.json','utf8')).baseline_live_functions;expect(after.functions.find(f=>f.signature==='public.billing_create_test_checkout_order(jsonb,integer)')).toEqual(live.find(f=>f.signature==='public.billing_create_test_checkout_order(jsonb,integer)'));
 expect(await db.sql("SELECT pg_get_indexdef('public.billing_orders_open_product_purpose_uidx'::regclass)")).toBe(m.tables.find(t=>t.name==='public.billing_orders').indexes.find(i=>i.definition.includes('billing_orders_open_product_purpose_uidx')).definition);
 expect(await db.sql("SELECT count(*) FROM public.billing_payment_attempts WHERE provider_order_id='synthetic-duplicate' AND provider IS NULL AND provider_account_ref IS NULL AND provider_environment IS NULL")).toBe('2');
});
it('matching installed Test checkout creates a fully order-bound new attempt',async()=>{
 const f=await actor(db),r=await checkout(db,f);expect(r.ok).toBe(true);
 expect(json(await db.sql('SELECT jsonb_build_object(\'provider\',provider,\'account\',provider_account_ref,\'environment\',provider_environment) FROM public.billing_payment_attempts WHERE id='+lit(r.payment_attempt_id)))).toEqual({provider:'paymob',account:f.account,environment:'test'});
});

const count=(table,f)=>db.sql('SELECT count(*) FROM '+table+' WHERE company_id='+lit(f.company));
it('settles a NEW persisted synthetic Test event into exact proof and replays concurrently once',async()=>{
 const f=await actor(db),r=await checkout(db,f),e=await storedEvent(db,f,r);
 const result=await Promise.all([settle(db,e.evidence),settle(db,e.evidence)]);for(const x of result)expect(x.ok).toBe(true);
 expect(await count('public.billing_entitlement_applications',f)).toBe('1');expect(await count('public.billing_settlement_outcomes',f)).toBe('1');expect(await count('private.billing_proven_entitlement_grants',f)).toBe('1');
 expect(await db.sql('SELECT environment FROM public.billing_subscriptions WHERE company_id='+lit(f.company))).toBe('test');
 expect(await settle(db,e.evidence)).toMatchObject({ok:true,outcome:'idempotent_replay'});
});
it('retains legacy NULL receipt and attempt scope through old callbacks and no-op replay updates',async()=>{
 expect(await settle(db,legacy.evidence)).toMatchObject({ok:false,code:'INVALID_STORED_EVIDENCE'});
 await db.sql(service('UPDATE public.billing_payment_attempts SET status=status,updated_at=updated_at WHERE id='+lit(legacy.attempt)+';'));
 for(const set of ["provider='paymob'","provider_account_ref='74001'","provider_environment='test'","provider_order_id='changed'","provider_intention_id='changed'"])await expect(db.sql(service('UPDATE public.billing_payment_attempts SET '+set+' WHERE id='+lit(legacy.attempt)+';'))).rejects.toThrow(/ATTEMPT_SCOPE_IMMUTABLE_OR_LEGACY_UNPROVEN/);
 expect(JSON.parse(await snapshotLegacy())).toEqual(legacyBefore);expect(await db.sql('SELECT count(*) FROM private.billing_proven_entitlement_grants WHERE id='+lit(legacy.grant))).toBe('0');
});
it('unknown historical order deadline is review-only even with pre-existing complete attempt scope',async()=>{
 const e=await storedEvent(db,preActor,preBound,{providerOrder:'synthetic-prebound',bind:false});
 expect(await settle(db,e.evidence)).toMatchObject({ok:true,outcome:'late_payment_review',code:'late_payment_policy_unapproved'});
 expect(await count('public.billing_entitlement_applications',preActor)).toBe('0');expect(await count('public.billing_subscriptions',preActor)).toBe('1');expect(await db.sql('SELECT environment IS NULL AND paid_through IS NULL FROM public.billing_subscriptions WHERE company_id='+lit(preActor.company))).toBe('t');
 expect(await db.sql('SELECT expires_at IS NULL AND deadline_policy_approved IS NULL FROM public.billing_orders WHERE id='+lit(preBound.order_id))).toBe('t');
 expect(await checkout(db,preActor)).toMatchObject({ok:false,code:'LEGACY_ORDER_REQUIRES_REVIEW'});
});
it('nullable/default-free environment and deadline keep all unknown legacy values unproven',async()=>{
 expect(await db.sql("SELECT count(*) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE ((a.attrelid='public.billing_subscriptions'::regclass AND a.attname='environment') OR (a.attrelid='public.billing_orders'::regclass AND a.attname IN ('expires_at','deadline_policy_approved'))) AND NOT a.attnotnull AND d.oid IS NULL")).toBe('3');
 const access=json(await db.sql(service('SELECT public.billing_read_company_operational_entitlement('+lit(legacy.company)+');')));expect(access).toMatchObject({ok:true,active:false,paid_through:null,plan_version_id:null});
});
it('unknown/false Live deadline policy and late collection retain evidence without paid grants',async()=>{
 for(const approval of [null,false]){const f=await actor(db),r=await manualOrder(db,f,{approval}),e=await storedEvent(db,f,r);expect(await settle(db,e.evidence)).toMatchObject({ok:true,outcome:'deadline_policy_review'});expect(await count('public.billing_entitlement_applications',f)).toBe('0');expect(await count('public.billing_subscriptions',f)).toBe('0');expect(await count('public.billing_provider_events',f)).toBe('1');}
 const f=await actor(db),r=await manualOrder(db,f,{environment:'test',expires:new Date(Date.now()-60000).toISOString()}),e=await storedEvent(db,f,r);expect(await settle(db,e.evidence)).toMatchObject({ok:true,outcome:'late_payment_review'});expect(await count('public.billing_entitlement_applications',f)).toBe('0');
 const unknown=await actor(db);await expect(manualOrder(db,unknown,{expires:null})).rejects.toThrow(/ATTEMPT_LEGACY_ORDER_UNPROVEN/);expect(await count('public.billing_payment_attempts',unknown)).toBe('0');
});
it('complete NEW offline Live-shaped evidence may prove finance but creates no service activation',async()=>{
 const f=await actor(db),r=await manualOrder(db,f,{approval:true}),e=await storedEvent(db,f,r);expect(await settle(db,e.evidence)).toMatchObject({ok:true,outcome:'granted'});
 expect(await count('private.billing_proven_entitlement_grants',f)).toBe('1');expect(json(await db.sql(service('SELECT public.billing_read_company_operational_entitlement('+lit(f.company)+');')))).toMatchObject({ok:true,active:true,environment:'live'});
 expect(await db.sql("SELECT to_regclass('private.billing_service_grants') IS NULL")).toBe('t');
});
it('strict persisted provenance rejects missing event, marker, types, underpayment and cross scope',async()=>{
 const f=await actor(db),r=await checkout(db,f),e=await storedEvent(db,f,r);
 for(const changes of [{evidence_marker:'untrusted'},{authenticity:{verified:true,method:'synthetic_test_only'}},{signature_verified:true},{company_id:legacy.company},{order_id:legacy.order},{payment_attempt_id:legacy.attempt},{provider_account_ref:'wrong'},{provider_environment:'live'},{amount_baisa:4999},{currency_expected:'USD'},{provider_transaction_id:'missing'},{observation_key:'missing'}])expect(await settle(db,{...e.evidence,...changes})).toMatchObject({ok:false,code:'INVALID_STORED_EVIDENCE'});
 expect(await count('public.billing_entitlement_applications',f)).toBe('0');
 for(const raw of [{hmac_verified:false},{amount_cents:4999},{pending:true},{is_auth:true},{is_capture:true},{signed_owner:'0'},{integration_id:'74001'}]){const a=await actor(db),order=await checkout(db,a),event=await storedEvent(db,a,order,{raw});expect((await settle(db,event.evidence)).ok).toBe(false);expect(await count('public.billing_entitlement_applications',a)).toBe('0');}
});
it('prospective proof postcondition atomically rejects malformed NEW financial receipt',async()=>{
 for(const raw of [{signed_owner:84001},{signed_owner:'9007199254740992'}]){
  const f=await actor(db),r=await checkout(db,f),e=await storedEvent(db,f,r,{raw});await expect(settle(db,e.evidence)).rejects.toThrow(/NEW_RECEIPT_PROOF_INCOMPLETE/);
  expect(await count('public.billing_entitlement_applications',f)).toBe('0');expect(await count('public.billing_subscriptions',f)).toBe('0');expect(await count('public.billing_provider_events',f)).toBe('1');expect(await db.sql('SELECT status FROM public.billing_payment_attempts WHERE id='+lit(r.payment_attempt_id))).toBe('provider_submitted');
 }
 const f=await actor(db);await expect(manualOrder(db,f,{environment:'test',periodCount:31})).rejects.toThrow(/billing_orders_period_day_align_chk/);expect(await count('public.billing_entitlement_applications',f)).toBe('0');
});
it('signed refund/void observations are idempotent review-only and never rewrite accepted receipt',async()=>{
 const f=await actor(db),r=await checkout(db,f),e=await storedEvent(db,f,r);const paid=await settle(db,e.evidence);expect(paid.outcome).toBe('granted');
 const before=await db.sql('SELECT to_jsonb(g) FROM public.billing_entitlement_applications g WHERE id='+lit(paid.entitlement_application_id));
 for(const flag of ['is_refunded','is_voided']){
  const obs=await storedEvent(db,f,r,{raw:{[flag]:true},eventStatus:flag==='is_refunded'?'refunded':'voided',bind:false});const review=await settle(db,obs.evidence);expect(review.outcome).toBe('lifecycle_review');expect((await settle(db,obs.evidence)).review_id).toBe(review.review_id);
 }
 expect(await db.sql('SELECT to_jsonb(g) FROM public.billing_entitlement_applications g WHERE id='+lit(paid.entitlement_application_id))).toBe(before);expect(await count('private.billing_lifecycle_reviews',f)).toBe('2');expect(await db.sql('SELECT status FROM public.billing_subscriptions WHERE company_id='+lit(f.company))).toBe('active');
});

it('concurrent checkout reuses one known snapshot and refuses caller price/period/account drift',async()=>{
 const f=await actor(db),op='synthetic-op-'+Date.now();const results=await Promise.all([checkout(db,f,{op}),checkout(db,f,{op})]);for(const r of results)expect(r.ok).toBe(true);expect(results[0].order_id).toBe(results[1].order_id);
 for(const overrides of [{p_amount_baisa:4999},{p_currency:'USD'},{p_period_days:31},{p_period_unit:'month'},{p_period_count:31},{p_provider_account_ref:'74002'}])expect((await checkout(db,f,{overrides})).ok).toBe(false);
 expect(await count('public.billing_orders',f)).toBe('1');
});
it('scoped provider-order arbiter blocks concurrent duplicate bindings and permits different account/environment',async()=>{
 const a=await actor(db),b=await actor(db),r1=await checkout(db,a),r2=await checkout(db,b),id='synthetic-shared-'+Date.now();
 const updates=[r1,r2].map(r=>db.sql(service('UPDATE public.billing_payment_attempts SET provider_order_id='+lit(id)+' WHERE id='+lit(r.payment_attempt_id)+';')));
 const results=await Promise.allSettled(updates);expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')[0].reason.message).toMatch(/billing_payment_attempts_provider_order_uidx/);
 const other=await actor(db),live=await manualOrder(db,other,{approval:null});await db.sql(service('UPDATE public.billing_payment_attempts SET provider_order_id='+lit(id)+' WHERE id='+lit(live.payment_attempt_id)+';'));
 const account=await actor(db);account.account='74002';const order=await checkout(db,account);await db.sql(service('UPDATE public.billing_payment_attempts SET provider_order_id='+lit(id)+' WHERE id='+lit(order.payment_attempt_id)+';'));
 expect(await db.sql('SELECT count(*) FROM public.billing_payment_attempts WHERE provider_order_id='+lit(id))).toBe('3');
});
it('new attempt scope, tenant, provider identifiers and order deadlines remain immutable',async()=>{
 const f=await actor(db),r=await checkout(db,f);await storedEvent(db,f,r);
 for(const set of ["provider=NULL","provider_account_ref='wrong'","provider_environment='live'","company_id="+lit(legacy.company),"order_id="+lit(legacy.order),"provider_order_id='changed'"])await expect(db.sql(service('UPDATE public.billing_payment_attempts SET '+set+' WHERE id='+lit(r.payment_attempt_id)+';'))).rejects.toThrow(/ATTEMPT_SCOPE_IMMUTABLE_OR_LEGACY_UNPROVEN/);
 for(const set of ["expires_at=NULL","expires_at=expires_at+interval '1 day'","product_code='other'","purchase_purpose='renew'","deadline_policy_approved=true"])await expect(db.sql(service('UPDATE public.billing_orders SET '+set+' WHERE id='+lit(r.order_id)+';'))).rejects.toThrow(/LOCKED_ORDER_IDENTITY_IMMUTABLE|DEADLINE_APPROVAL_ALREADY_BOUND/);
 await expect(db.sql(service('INSERT INTO public.billing_payment_attempts(order_id,company_id,provider_account_ref) VALUES('+lit(r.order_id)+','+lit(f.company)+',\'wrong\');'))).rejects.toThrow(/ATTEMPT_PROVIDER_SCOPE_MISMATCH/);
});
it('provider event scope and amount are checked before persistence',async()=>{
 const f=await actor(db),r=await checkout(db,f);
 await expect(db.sql(service('INSERT INTO public.billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected) VALUES('+lit(r.payment_attempt_id)+','+lit(f.company)+',\'paymob\',\'74001\',\'test\',\'synthetic-mismatch\',\'success\',\'synthetic-mismatch\',4999,\'OMR\');'))).rejects.toThrow(/EVENT_PROVIDER_SCOPE_MISMATCH/);expect(await count('public.billing_provider_events',f)).toBe('0');
});
it('application roles cannot execute private writers/reviews and authenticated cross-tenant reads deny',async()=>{
 for(const role of ['anon','authenticated'])for(const signature of ['public.billing_settle_paymob_hmac_verified(jsonb)','public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'])expect(await db.sql('SELECT has_function_privilege('+lit(role)+','+lit(signature)+",'EXECUTE')")).toBe('f');
 for(const role of ['anon','authenticated','service_role']){
  for(const signature of ['private.billing_settle_payment_core_pre_acceptance(jsonb)','private.billing_settle_payment_core(jsonb)','private.billing_acceptance_hmac_event(jsonb)','private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text)','private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)'])expect(await db.sql('SELECT has_function_privilege('+lit(role)+','+lit(signature)+",'EXECUTE')")).toBe('f');
  await expect(db.sql('SET ROLE '+role+';SELECT * FROM private.billing_lifecycle_reviews')).rejects.toThrow(/permission denied/);
 }
 const f=await actor(db);const own=json(await db.sql('BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.role=\'authenticated\';SET LOCAL request.jwt.claim.sub='+lit(f.user)+';SELECT public.billing_read_company_operational_entitlement('+lit(f.company)+');COMMIT;'));expect(own).toMatchObject({ok:true,active:false});
 const denied=json(await db.sql('BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.role=\'authenticated\';SET LOCAL request.jwt.claim.sub='+lit(f.user)+';SELECT public.billing_read_company_operational_entitlement('+lit(legacy.company)+');COMMIT;'));expect(denied).toMatchObject({ok:false,code:'forbidden'});
});
it('keeps corrected Stage1 guard and pins only genuinely changed forward writer bodies',async()=>{
 const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
 expect(await db.sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.billing_financial_receipt_immutability()'::regprocedure")).toBe(manifest.stage1_guard_body_md5);
 for(const [name,hash] of Object.entries(manifest.forward_body_hashes))expect(await db.sql('SELECT md5(replace(prosrc,chr(13),\'\')) FROM pg_proc WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='+lit(name.split('.')[0])+') AND proname='+lit(name.split('.')[1]))).toBe(hash);
 expect(JSON.parse(await snapshotLegacy())).toEqual(legacyBefore);expect(await budgets()).toBe(budgetBefore);
 const original=metadata();for(const t of original.tables){for(const fk of t.constraints.filter(c=>c.type==='f'))expect(await db.sql("BEGIN READ ONLY;SET LOCAL search_path='';SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid="+lit(t.name)+'::regclass AND conname='+lit(fk.name)+';COMMIT;')).toBe(fk.definition);}
});

it('refuses a NEW binding that would claim an identifier held by unknown legacy attempts',async()=>{
 const f=await actor(db),r=await checkout(db,f);
 await expect(db.sql(service('UPDATE public.billing_payment_attempts SET provider_order_id=\'synthetic-duplicate\' WHERE id='+lit(r.payment_attempt_id)+';'))).rejects.toThrow(/LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS/);
 expect(await db.sql('SELECT provider_order_id IS NULL FROM public.billing_payment_attempts WHERE id='+lit(r.payment_attempt_id))).toBe('t');
 expect(await db.sql("SELECT count(*) FROM public.billing_payment_attempts WHERE provider_order_id='synthetic-duplicate' AND provider IS NULL")).toBe('2');
});

it('refuses INSERT legacy identifier claims with explicit, omitted and partial scope including conflict handling',async()=>{
 const f=await actor(db),r=await checkout(db,f);
 const before=await db.sql("SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.billing_payment_attempts a WHERE provider_order_id='synthetic-duplicate'");
 for(const [columns,values] of [['',''],[',provider,provider_account_ref,provider_environment',",'paymob','74001','test'"],[',provider_account_ref',",'74001'"]]){
  for(const conflict of ['', ' ON CONFLICT DO NOTHING'])await expect(db.sql(service('INSERT INTO public.billing_payment_attempts(order_id,company_id,attempt_seq,provider_order_id'+columns+') VALUES('+lit(r.order_id)+','+lit(f.company)+",2,'synthetic-duplicate'"+values+')'+conflict+';'))).rejects.toThrow(/LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS/);
 }
 expect(await count('public.billing_payment_attempts',f)).toBe('1');
 expect(await db.sql("SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.billing_payment_attempts a WHERE provider_order_id='synthetic-duplicate'")).toBe(before);
});
it('concurrent INSERT and UPDATE both refuse unknown legacy claims and arbitrate fresh scope',async()=>{
 const a=await actor(db),b=await actor(db),r1=await checkout(db,a),r2=await checkout(db,b);
 const insert=id=>db.sql(service('INSERT INTO public.billing_payment_attempts(order_id,company_id,attempt_seq,provider_order_id) VALUES('+lit(r1.order_id)+','+lit(a.company)+',2,'+lit(id)+');'));
 const update=id=>db.sql(service('UPDATE public.billing_payment_attempts SET provider_order_id='+lit(id)+' WHERE id='+lit(r2.payment_attempt_id)+';'));
 const refused=await Promise.allSettled([insert('synthetic-duplicate'),update('synthetic-duplicate')]);
 for(const result of refused){expect(result.status).toBe('rejected');expect(result.reason.message).toMatch(/LEGACY_PROVIDER_ORDER_SCOPE_AMBIGUOUS/);}
 expect(await db.sql("SELECT count(*) FROM public.billing_payment_attempts WHERE provider_order_id='synthetic-duplicate' AND provider IS NULL")).toBe('2');
 const fresh='synthetic-insert-update-'+Date.now(),results=await Promise.allSettled([insert(fresh),update(fresh)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')[0].reason.message).toMatch(/billing_payment_attempts_provider_order_uidx/);
 expect(await db.sql('SELECT count(*) FROM public.billing_payment_attempts WHERE provider_order_id='+lit(fresh))).toBe('1');
});
