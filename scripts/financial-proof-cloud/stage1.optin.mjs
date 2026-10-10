import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isolatedPostgres,lit} from '../g03-review-acceptance/postgres.mjs';
import {metadata,replay,sourceDefinitions} from './fixture-replay.mjs';
import {fixture,json,service} from './fixtures.mjs';
const directory='supabase/upgrade-packages/financial-proof-cloud/';
let db,legacy,before,otherBefore;
const manifest=JSON.parse(readFileSync(directory+'manifest.json','utf8'));
const query=readFileSync(directory+'preflight.readonly.sql','utf8');
const cte=query.slice(query.indexOf('with targets'),query.indexOf("select jsonb_build_object('project'"));
const fingerprints=()=>db.sql("BEGIN READ ONLY;SET LOCAL search_path='';"+cte+"select jsonb_build_object('tables',(select jsonb_object_agg(name,md5(to_jsonb(t)::text)) from t),'functions',(select jsonb_object_agg(signature,md5(to_jsonb(f)::text)) from f));COMMIT;").then(json);
const install=()=>db.sql("SET ROLE postgres;"+readFileSync(directory+'10-stage1.review.sql','utf8'));
async function snapshot(){
 const parts=Object.keys(manifest.tables).map(t=>lit(t)+",(SELECT jsonb_agg("+((t.endsWith('billing_payment_attempts'))?"to_jsonb(x)-'{provider,provider_account_ref,provider_environment}'::text[]":t.endsWith('billing_entitlement_applications')?"to_jsonb(x)-'status'":"to_jsonb(x)")+" ORDER BY id) FROM "+t+" x)");
 return db.sql('SELECT jsonb_build_object('+parts.join(',')+');');
}
beforeAll(async()=>{
 db=await isolatedPostgres();await replay(db,metadata());
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});
 legacy=await fixture(db);before=await snapshot();otherBefore=await db.sql("SELECT jsonb_build_object('budget',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_budget_accounts x),'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_usage_ledger x));");

});
afterAll(async()=>{if(db)await db.close();});
it('rolls back every additive object and keeps legacy rows on interrupted installation',async()=>{
 const interrupted=readFileSync(directory+'10-stage1.review.sql','utf8').replace(/commit;\s*$/i,"DO $$BEGIN RAISE EXCEPTION 'SYNTHETIC_INTERRUPTION';END;$$;COMMIT;");
 await expect(db.sql('SET ROLE postgres;'+interrupted)).rejects.toThrow(/SYNTHETIC_INTERRUPTION/);
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});
 expect(await snapshot()).toBe(before);
});
it('rejects a partially added evidence column atomically',async()=>{
 await db.sql('ALTER TABLE public.billing_entitlement_applications ADD status text;');
 await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql('ALTER TABLE public.billing_entitlement_applications DROP status;');
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});
 expect(await snapshot()).toBe(before);
});
it('rejects changed defaults and function ownership without changing receipts',async()=>{
 await db.sql("ALTER TABLE public.billing_payment_attempts ALTER attempt_seq SET DEFAULT 2;");
 await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql("ALTER TABLE public.billing_payment_attempts ALTER attempt_seq SET DEFAULT 1;");
 await db.sql('ALTER FUNCTION private.billing_settle_payment_core(jsonb) OWNER TO supabase_admin;');
 await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);
 await db.sql('ALTER FUNCTION private.billing_settle_payment_core(jsonb) OWNER TO postgres;');
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});
 expect(await snapshot()).toBe(before);
});
it('rejects exact writer body, index, constraint, schema owner and ACL drift',async()=>{
 const f=metadata().functions.find(f=>f.signature==='public.billing_settle_paymob_hmac_verified(jsonb)');
 const original=sourceDefinitions().find(d=>d.name==='public.billing_settle_paymob_hmac_verified'&&d.hash===f.body_md5).sql.replace(/create\s+(?:or\s+replace\s+)?function/i,'CREATE OR REPLACE FUNCTION');
 const changed=original.replace(/(\$[a-z_0-9]*\$);\s*$/i,'\n-- synthetic body drift\n$1;');
 await db.sql(changed);await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);await db.sql(original);
 const orders=metadata().tables.find(t=>t.name==='public.billing_orders');
 const idx=orders.indexes.find(i=>i.definition.includes('billing_orders_company_created_idx'));
 await db.sql('DROP INDEX public.billing_orders_company_created_idx;');await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);await db.sql(idx.definition+';');
 await db.sql('GRANT SELECT ON public.billing_orders TO anon;');await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);await db.sql('REVOKE SELECT ON public.billing_orders FROM anon;');
 await db.sql('ALTER TABLE public.billing_orders ADD CONSTRAINT synthetic_stage1_check CHECK(amount_baisa>0);');await expect(install()).rejects.toThrow(/STAGE1_CATALOG_PREREQUISITE_MISMATCH/);await db.sql('ALTER TABLE public.billing_orders DROP CONSTRAINT synthetic_stage1_check;');
 await db.sql('ALTER SCHEMA private OWNER TO supabase_admin;');await expect(install()).rejects.toThrow(/STAGE1_PRIVATE_SCHEMA_PREREQUISITE_MISMATCH|permission denied/);await db.sql('ALTER SCHEMA private OWNER TO postgres;');
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});expect(await snapshot()).toBe(before);
});
it('bounded DDL lock fails atomically while a writer holds the table',async()=>{
 await db.verify();const holder=db.session("BEGIN;LOCK public.billing_provider_events IN ROW EXCLUSIVE MODE;SELECT 'SYNTHETIC_LOCK_READY';",'stage1-lock',{keepOpen:true});
 try {
  const started=Date.now();while(!holder.output().includes('SYNTHETIC_LOCK_READY')){if(Date.now()-started>5000)throw Error('LOCK_NOT_READY');await new Promise(r=>setTimeout(r,50));}
  await expect(install()).rejects.toThrow(/lock timeout/);
 }finally{holder.child.stdin.end('ROLLBACK;\n');await holder.done;}
 expect(await fingerprints()).toEqual({tables:manifest.tables,functions:manifest.functions});
 expect(await snapshot()).toBe(before);
});
it('installs only nullable evidence and immutable private proof objects',async()=>{
 await install();expect(await snapshot()).toBe(before);expect(await db.sql("SELECT jsonb_build_object('budget',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_budget_accounts x),'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ai_usage_ledger x));")).toBe(otherBefore);
 const actual=json(await db.sql(query));for(const t of metadata().tables){const a=actual.tables.find(x=>x.name===t.name);expect(a.acl).toEqual(t.acl);expect(a.column_acl).toEqual(t.column_acl);}
 expect(actual.functions).toEqual(metadata().functions);
 expect(json(await db.sql("SELECT jsonb_build_object('history',(SELECT count(*) FROM private.billing_verified_collection_history),'active',(SELECT count(*) FROM private.billing_proven_entitlement_grants));"))).toEqual({history:0,active:0});
 const newcols=await db.sql("SELECT count(*) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE ((a.attrelid='public.billing_payment_attempts'::regclass AND a.attname IN ('provider','provider_account_ref','provider_environment')) OR (a.attrelid='public.billing_entitlement_applications'::regclass AND a.attname='status')) AND NOT a.attnotnull AND d.oid IS NULL AND format_type(a.atttypid,a.atttypmod)='text';");expect(newcols).toBe('4');
 await expect(install()).rejects.toThrow(/STAGE1_ALREADY_OR_PARTIALLY_INSTALLED/);
});
it('protects legacy provider receipt from mutation',async()=>{
 await expect(db.sql("SET ROLE postgres;UPDATE public.billing_provider_events SET raw_summary=raw_summary||'{\"synthetic_changed\":true}' WHERE id="+lit(legacy.event))).rejects.toThrow(/BILLING_PROVIDER_RECEIPT_IMMUTABLE/);
});

const proofCount=f=>db.sql('SELECT count(*) FROM private.billing_proven_entitlement_grants WHERE id='+lit(f.grant));
it('actual installed settlement writer remains idempotent under concurrent replays',async()=>{
 const fresh=await fixture(db);const input=lit(JSON.stringify(fresh.evidence))+'::jsonb';
 const results=await Promise.all([db.sql(service('SELECT public.billing_settle_paymob_hmac_verified('+input+');')),db.sql(service('SELECT public.billing_settle_paymob_hmac_verified('+input+');'))]);
 for(const r of results)expect(json(r).ok).toBe(true);
 expect(await db.sql('SELECT count(*) FROM public.billing_entitlement_applications WHERE payment_attempt_id='+lit(fresh.attempt))).toBe('1');
 expect(await db.sql('SELECT count(*) FROM public.billing_provider_events WHERE payment_attempt_id='+lit(fresh.attempt))).toBe('1');
 expect(await db.sql('SELECT count(*) FROM public.billing_settlement_outcomes WHERE payment_attempt_id='+lit(fresh.attempt))).toBe('1');
 expect(await proofCount(fresh)).toBe('0');
});
it('installed purchase writer keeps its published price and replay contract',async()=>{
 const fresh=await fixture(db);const id='synthetic-purchase-'+fresh.user;
 const args=[lit(fresh.company),"'velora_ai_staff'","'renew'",lit(fresh.version),'NULL',lit(id),lit(id),lit(id),'5000',"'OMR'",'30',"'day'",'30',lit(fresh.account),"'test'",lit(fresh.user)].join(',');
 const r=json(await db.sql(service('SELECT public.billing_create_or_reuse_subscription_order('+args+');')));
 expect(r.ok).toBe(true);
 const replayed=json(await db.sql(service('SELECT public.billing_create_or_reuse_subscription_order('+args+');')));expect(replayed.order_id).toBe(r.order_id);
 expect(await db.sql('SELECT amount_baisa FROM public.billing_orders WHERE id='+lit(r.order_id))).toBe('5000');
});
it('complete NEW synthetic test and live-shaped receipts prove only exact bound evidence',async()=>{
 for(const environment of ['test','live']){const f=await fixture(db,{proof:true,environment});expect(await proofCount(f)).toBe('1');}
});
it('incomplete receiver attestation and mismatched amount are unproved',async()=>{
 for(const raw of [{hmac_verified:false},{signed_owner:'0'},{is_auth:true},{is_capture:true},{is_refunded:true},{is_voided:true},{pending:true},{success:false},{error_occured:true},{is_standalone_payment:false},{has_parent_transaction:true},{provider_order_id:'mismatch'},{integration_id:74002},{amount_cents:4999},{currency:'USD'}]){
  const f=await fixture(db,{proof:true,environment:'live',raw});expect(await proofCount(f)).toBe('0');
 }
 const f=await fixture(db,{proof:true,amount:4999});expect(await proofCount(f)).toBe('0');
 const h=await fixture(db,{proof:true,environment:'live',method:'authorized_synthetic_test'});expect(await proofCount(h)).toBe('0');
});
it('provider/account/environment/tenant/period joins fail closed',async()=>{
 for(const set of ["provider=NULL","provider_account_ref='wrong'","provider_environment='live'","company_id=NULL"]){
  const f=await fixture(db,{proof:true});
  // company_id is NOT NULL: its constraint independently rejects this mismatch.
  if(set==='company_id=NULL'){await expect(db.sql('UPDATE public.billing_payment_attempts SET '+set+' WHERE id='+lit(f.attempt))).rejects.toThrow(/not-null constraint/);continue;}
  await db.sql('UPDATE public.billing_payment_attempts SET '+set+' WHERE id='+lit(f.attempt));expect(await proofCount(f)).toBe('0');
 }
 const period=await fixture(db,{proof:true,periodCount:31});expect(await proofCount(period)).toBe('0');
 const tenant=await fixture(db,{proof:true});const other=await fixture(db,{proof:true});await expect(db.sql('UPDATE public.billing_payment_attempts SET company_id='+lit(other.company)+' WHERE id='+lit(tenant.attempt))).rejects.toThrow(/billing_entitlement_applications_attempt_company_fkey/);expect(await proofCount(tenant)).toBe('1');
 const f=await fixture(db,{proof:true});await db.sql('UPDATE public.billing_payment_attempts SET status=\'provider_submitted\' WHERE id='+lit(f.attempt));expect(await proofCount(f)).toBe('0');expect(await db.sql('SELECT count(*) FROM private.billing_verified_collection_history WHERE id='+lit(f.grant))).toBe('1');
});
it('all three receipts reject deletion, truncation and immutable field mutation',async()=>{
 const f=await fixture(db,{proof:true});
 for(const [table,id,field,code] of [['billing_provider_events',f.event,"raw_summary=\'{\"changed\":true}\'",'PROVIDER'],['billing_entitlement_applications',f.grant,"applied_paid_through=applied_paid_through+interval \'1 day\'",'ENTITLEMENT'],['billing_settlement_outcomes',f.outcome,"outcome=\'ignored\'",'SETTLEMENT']]){
  await expect(db.sql('UPDATE public.'+table+' SET '+field+' WHERE id='+lit(id))).rejects.toThrow(new RegExp('BILLING_'+code+'_RECEIPT_IMMUTABLE'));
  await expect(db.sql('DELETE FROM public.'+table+' WHERE id='+lit(id))).rejects.toThrow(/BILLING_FINANCIAL_RECEIPT_APPEND_ONLY/);
  await expect(db.sql('TRUNCATE public.'+table+' CASCADE')).rejects.toThrow(/BILLING_FINANCIAL_RECEIPT_APPEND_ONLY/);
 }
});
it('permits exact receipt upsert, outcome detail replay and active to revoked only',async()=>{
 const f=await fixture(db,{proof:true});
 await db.sql('UPDATE public.billing_provider_events SET raw_summary=raw_summary WHERE id='+lit(f.event));
 await db.sql('INSERT INTO public.billing_provider_events SELECT * FROM public.billing_provider_events WHERE id='+lit(f.event)+' ON CONFLICT(id) DO UPDATE SET raw_summary=EXCLUDED.raw_summary;');
 await db.sql('UPDATE public.billing_settlement_outcomes SET detail=\'{\"synthetic_replayed\":true}\' WHERE id='+lit(f.outcome));
 await db.sql('UPDATE public.billing_entitlement_applications SET status=\'revoked\' WHERE id='+lit(f.grant));
 expect(await proofCount(f)).toBe('0');expect(await db.sql('SELECT count(*) FROM private.billing_verified_collection_history WHERE id='+lit(f.grant))).toBe('1');
 await expect(db.sql('UPDATE public.billing_entitlement_applications SET status=\'active\' WHERE id='+lit(f.grant))).rejects.toThrow(/BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE/);
});
it('denies private proof views and direct receipt guard execution to every application role',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  for(const view of ['billing_verified_collection_history','billing_proven_entitlement_grants'])await expect(db.sql('SET ROLE '+role+';SELECT * FROM private.'+view)).rejects.toThrow(/permission denied/);
  expect(await db.sql('SELECT has_function_privilege('+lit(role)+",'private.billing_financial_receipt_immutability()','EXECUTE');")).toBe('f');
 }
});
it('rejects changing historical NULL status into revoked',async()=>{
 await expect(db.sql("SET ROLE postgres;UPDATE public.billing_entitlement_applications SET status='revoked' WHERE id="+lit(legacy.grant))).rejects.toThrow(/BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE/);
});

it('rejects active receipt status becoming NULL',async()=>{
 const f=await fixture(db,{proof:true});
 await expect(db.sql('UPDATE public.billing_entitlement_applications SET status=NULL WHERE id='+lit(f.grant))).rejects.toThrow(/BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE/);
});

it('preserves same-status values and allows only active to revoked across every old/new status pair',async()=>{
 const statuses=[null,'active','revoked','unproved'];
 const original=await db.sql('SELECT to_jsonb(g) FROM public.billing_entitlement_applications g WHERE id='+lit(legacy.grant));
 for(const old of statuses){
  const f=old===null?legacy:await fixture(db,{proof:true,status:old});
  for(const next of statuses){
   const update='BEGIN;SET LOCAL ROLE service_role;UPDATE public.billing_entitlement_applications SET status='+(next===null?'NULL':lit(next))+' WHERE id='+lit(f.grant)+';ROLLBACK;';
   if(old===next||(old==='active'&&next==='revoked'))await db.sql(update);
   else await expect(db.sql(update)).rejects.toThrow(/BILLING_ENTITLEMENT_RECEIPT_IMMUTABLE/);
  }
  expect(await db.sql('SELECT status IS NOT DISTINCT FROM '+(old===null?'NULL':lit(old))+' FROM public.billing_entitlement_applications WHERE id='+lit(f.grant))).toBe('t');
 }
 expect(await db.sql('SELECT to_jsonb(g) FROM public.billing_entitlement_applications g WHERE id='+lit(legacy.grant))).toBe(original);
});
it('pins the approved one-expression divergence without changing the canonical migration',async()=>{
 expect(await db.sql("SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid='private.billing_financial_receipt_immutability()'::regprocedure;")).toBe(manifest.package_guard_body_md5);
 const canonical=readFileSync('supabase/migrations/20261008161000_vel_billing_receipt_immutability.sql','utf8').replaceAll('\r','');
 const begin=canonical.indexOf('as $$')+5,end=canonical.indexOf('$$;',begin);
 const {createHash}=await import('node:crypto');expect(createHash('md5').update(canonical.slice(begin,end)).digest('hex')).toBe(manifest.canonical_guard_body_md5);
 expect(manifest.package_guard_body_md5).not.toBe(manifest.canonical_guard_body_md5);
});
