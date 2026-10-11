// Explicit opt-in: attach only to a validated, network-disabled schema-only test isolate.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {attachIsolate} from './postgres.mjs';
const db=await attachIsolate();
const query=readFileSync('supabase/upgrade-packages/ai-runtime-compatibility/05-package-footprint.readonly.sql','utf8').split("WITH fn AS (",2)[1].split('COMMIT;')[0].trim().replace(/;$/,'');
const fingerprint=()=>db.sql(`SET search_path='';SELECT md5(data::text) FROM (WITH fn AS (${query}) q(data);`);
const expected='65dd4e93dd82467da59476a9d4541646';
assert.equal(await fingerprint(),expected,'INSTALLED_FOOTPRINT_DRIFT');
const policyQuery=readFileSync('supabase/upgrade-packages/ai-runtime-compatibility/07-policy-column-acl.readonly.sql','utf8').split('WITH targets AS (',2)[1].split('COMMIT;')[0].trim().replace(/;$/,'');
const permissions=()=>db.sql(`SET search_path='';SELECT md5(data::text) FROM (WITH targets AS (${policyQuery}) q(data);`);
assert.equal(await permissions(),'81b4093b74ade15c32463fe79f10331c','POLICY_COLUMN_ACL_DRIFT');
const history=()=>db.sql(`SELECT jsonb_build_object('budget',coalesce((SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY id)::text) FROM public.ai_budget_accounts b),''),'ledger',coalesce((SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM public.ai_usage_ledger l),''));`);
const before=await history();
for(const path of ['scripts/security-foundation/ai-security.sql','scripts/ai-runtime-compatibility/budget-binding.sql','scripts/ai-runtime-compatibility/owner-budget.sql']){
 const result=await db.file(path);assert(!result.includes('FAIL|'));console.log(result);
}
assert.equal(await history(),before,'REGRESSIONS_CHANGED_HISTORY');
for(const name of ['10-accounting.review.sql','20-budget-binding.review.sql','30-customer-runtime.review.sql']){
 await assert.rejects(db.file(`supabase/upgrade-packages/ai-runtime-compatibility/${name}`),/AI_COMPAT_(?:POLICY_)?PREFLIGHT_DRIFT/);
 assert.equal(await fingerprint(),expected,'REPLAY_CHANGED_SCHEMA');assert.equal(await permissions(),'81b4093b74ade15c32463fe79f10331c','REPLAY_CHANGED_PERMISSIONS');assert.equal(await history(),before,'REPLAY_CHANGED_HISTORY');
}
const policyGuards=readFileSync('supabase/upgrade-packages/ai-runtime-compatibility/30-customer-runtime.review.sql','utf8').match(/DO \$ai_policy_guard\$[\s\S]*?END \$ai_policy_guard\$;/g);
assert.equal(policyGuards.length,2);
for(const mutation of ["ALTER POLICY ai_usage_read ON public.ai_usage_ledger USING (true);","ALTER POLICY velora_active_session ON public.ai_usage_ledger USING (true);","GRANT SELECT(worker_claim_token) ON public.ai_usage_ledger TO authenticated;"]){
 await assert.rejects(db.sql(`BEGIN;SET LOCAL ROLE postgres;SET LOCAL search_path='';${mutation}${policyGuards[1]}COMMIT;`),/AI_COMPAT_POLICY_POSTFLIGHT_DRIFT/);
 assert.equal(await permissions(),'81b4093b74ade15c32463fe79f10331c','PERMISSION_DRIFT_TEST_NOT_ROLLED_BACK');assert.equal(await history(),before,'PERMISSION_DRIFT_CHANGED_HISTORY');
}
console.log('PASS|RLS/session policy widening and sensitive column grant drift reject and roll back');
console.log('PASS|Exact installed footprint, failed replay, and regression history preservation');
await db.close();
