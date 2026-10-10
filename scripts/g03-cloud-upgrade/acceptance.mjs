// Opt-in synthetic PostgreSQL acceptance, no credentials/URL/.env or provider SDK.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isolatedPostgres,lit } from '../g03-review-acceptance/postgres.mjs';
import { assemble } from './build.mjs';
const metadata=process.argv[2];if(!metadata)throw Error('PRIVATE_METADATA_PATH_REQUIRED');
const db=await isolatedPostgres(), {containment,bundle}=assemble();let passed=0;
const id=s=>createHash('md5').update(s).digest('hex').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
const a={user:id('upgrade-owner'),company:id('upgrade-company'),sid:id('upgrade-session')};
const other={user:id('upgrade-other'),company:id('upgrade-other-company'),sid:id('upgrade-other-session')};
const source=id('upgrade-text'),file=id('upgrade-file');
const claims=who=>`SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(who.user)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:who.user,session_id:who.sid,role:'authenticated'}))};`;
const query=(who,q)=>db.sql(`BEGIN;${claims(who)}${q}COMMIT;`);
const direct=who=>query(who,`SELECT public.transition_company_review('submit',${lit(who.company)},null,'own','+96800000000',true,null);`);
const c=async(name,fn)=>{await fn();console.log(`PASS ${name}`);passed++;};
async function seed(who){await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(who.user)},'synthetic-${who.user}@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) VALUES(${lit(who.sid)},${lit(who.user)});
INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(who.sid)},${lit(who.user)},clock_timestamp());
INSERT INTO public.companies(id,display_name,business_type,hours,created_by) VALUES(${lit(who.company)},'Synthetic','restaurant','09-18',${lit(who.user)});
INSERT INTO public.company_members(company_id,user_id,role,status) VALUES(${lit(who.company)},${lit(who.user)},'owner','active');`);}
const snapshot=()=>db.sql(`SELECT jsonb_build_object('knowledge',(select jsonb_agg(to_jsonb(k)-'usage_role'-'prepared_file_sha256'-'prepared_text_sha256'-'prepared_content_version' order by id) from public.knowledge_sources k),
'history',(select jsonb_agg(to_jsonb(a) order by id) from public.admin_audit_logs a),
'reviews',(select jsonb_agg(to_jsonb(r)-'submitted_manifest'-'submitted_manifest_sha256'-'submitted_input_epoch'-'submitted_intent_sha256'-'proof_checked_at' order by company_id) from public.company_review_requests r));`);
try {
 await db.bootstrap({baselineMetadataPath:metadata});await seed(a);await seed(other);
 await db.sql(`INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,created_by) VALUES(${lit(source)},${lit(a.company)},'text','Historical menu','Tea 1 OMR','ready',${lit(a.user)});
INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(file)},${lit(a.company)},'file','Historical file','old extraction','ready','menu.txt','text/plain',3,${lit(`${a.company}/${file}/menu.txt`)},${lit(a.user)});`);
 await query(a,`SELECT public.set_knowledge_source_approval(${lit(source)},true);SELECT public.set_knowledge_source_approval(${lit(file)},true);`);
 await c('RED confirms actual baseline accepts unproven readiness',async()=>assert.equal(JSON.parse(await direct(a)).ok,true));
 await c('baseline lacks published knowledge columns and scoped review history',async()=>{
  await assert.rejects(query(a,'SELECT usage_role,prepared_file_sha256 FROM public.knowledge_sources;'),/does not exist/);
  await assert.rejects(query(a,`SELECT public.list_owner_company_review_events_for_company(${lit(a.company)});`),/does not exist/);
 });
 const before=await snapshot();
 await c('upgrade without containment refuses with no changes',async()=>{await assert.rejects(db.sql(bundle),/CONTAINMENT_REQUIRED/);assert.equal(await snapshot(),before);});
 await db.sql(containment);
 await c('containment is repeatable and blocks authorized old mutation without deleting history',async()=>{await db.sql(containment);assert.equal(JSON.parse(await direct(other)).code,'UPGRADE_PENDING');assert.equal(await snapshot(),before);});
 await c('real second backend prevents upgrade until transactions drain',async()=>{
  const s=db.session("BEGIN; SELECT pg_backend_pid(); SELECT 'HELD';",'g03-upgrade-held',{keepOpen:true});s.done.catch(()=>{});
  const until=Date.now()+5000;while(!s.output().includes('HELD')){if(Date.now()>until)throw Error('HOLDER_TIMEOUT');await new Promise(r=>setTimeout(r,20));}
  try{await assert.rejects(db.sql(bundle),/REVIEW_WINDOW_NOT_DRAINED/);assert.equal(await snapshot(),before);}
  finally{s.child.stdin.end('COMMIT;');await s.done;}
 });
 await c('postflight failure rolls back all DDL and preserves contained writer/history',async()=>{
  const broken=bundle.replace("notify pgrst,'reload schema';\ncommit;", "do $$ begin raise exception 'synthetic_postflight_failure';end $$;\ncommit;");
  await assert.rejects(db.sql(broken),/synthetic_postflight_failure/);
  assert.equal(await db.sql("SELECT to_regclass('private.g03_review_checks') IS NULL;"),'t');
  assert.equal(await snapshot(),before);assert.equal(JSON.parse(await direct(other)).code,'UPGRADE_PENDING');
 });
 await c('atomic upgrade preserves all historical columns/content/audit rows',async()=>{await db.sql(bundle);assert.equal(await snapshot(),before);});
 await c('legacy files retain no fabricated extraction proof',async()=>{
  assert.equal(await db.sql(`SELECT prepared_file_sha256 IS NULL AND prepared_text_sha256 IS NULL AND prepared_content_version IS NULL AND approved_for_answers FROM public.knowledge_sources WHERE id=${lit(file)};`),'t');
  const result=JSON.parse(await query(a,`SELECT public.g03_begin_review_check('resubmit',${lit(a.company)},1,'own','+96800000000',true,null);`));assert.equal(result.code,'FILE_REPREPARE_REQUIRED');
 });
 await c('legacy direct RPC cannot submit/approve without trusted proof',async()=>{assert.equal(JSON.parse(await direct(other)).code,'PROOF_REQUIRED');assert.equal(await db.sql(`SELECT count(*) FROM public.company_review_requests WHERE company_id=${lit(other.company)};`),'0');});
 await c('usage_role saves invalidate approval exactly once; protected fields deny direct writes',async()=>{
  await query(a,`UPDATE public.knowledge_sources SET usage_role='business_instructions' WHERE id=${lit(source)};`);
  assert.equal(await db.sql(`SELECT content_version=2 AND NOT approved_for_answers AND approved_version IS NULL FROM public.knowledge_sources WHERE id=${lit(source)};`),'t');
  await assert.rejects(query(a,`UPDATE public.knowledge_sources SET prepared_file_sha256=repeat('a',64) WHERE id=${lit(source)};`),/permission denied/);
  await assert.rejects(query(a,`UPDATE public.knowledge_sources SET approved_for_answers=true WHERE id=${lit(source)};`),/permission denied/);
 });
 await c('tenant history isolation, source RLS and anonymous/service RPC matrix',async()=>{
  const events=JSON.parse(await query(a,`SELECT public.list_owner_company_review_events_for_company(${lit(a.company)});`));assert.equal(events.length,1);
  await assert.rejects(query(other,`SELECT public.list_owner_company_review_events_for_company(${lit(a.company)});`),/forbidden/);
  assert.equal(await query(other,`SELECT count(*) FROM public.knowledge_sources WHERE company_id=${lit(a.company)};`),'0');
  await assert.rejects(db.sql(`BEGIN;SET LOCAL ROLE anon;SELECT public.g03_read_review_request(${lit(a.company)});COMMIT;`),/permission denied/);
  await assert.rejects(db.sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.transition_company_review('submit',${lit(other.company)},null,'new','',true,null);COMMIT;`),/permission denied/);
  await db.file('supabase/upgrade-packages/g03-cloud-compatibility/postflight.sql');
 });
 await c('reapplying package refuses without resetting evidence or history',async()=>{const state=await snapshot();await assert.rejects(db.sql(bundle),/ALREADY_UPGRADED_OR_PARTIAL_BASELINE/);assert.equal(await snapshot(),state);});
 console.log(`PASS ${passed}; FAIL 0`);
} catch(e){console.error(`FAIL after ${passed}: ${e.message}`);process.exitCode=1;}
finally{await db.close();}
