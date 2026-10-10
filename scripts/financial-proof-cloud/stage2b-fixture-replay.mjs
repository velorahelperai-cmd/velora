// Isolated cumulative replay. Never connects to production or reads environment credentials.
import {readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {metadata,replay,sourceDefinitions} from './fixture-replay.mjs';
import {fixture,json} from './fixtures.mjs';
import {lit} from '../g03-review-acceptance/postgres.mjs';
const q=s=>'"'+s.replaceAll('"','""')+'"';
export const directory='supabase/upgrade-packages/financial-proof-cloud-stage2b/';
export const requiredColumns=t=>t.name==='auth.users'?t.columns.filter(c=>['id','email','email_confirmed_at','phone_confirmed_at'].includes(c.name)):t.name==='auth.sessions'?t.columns.filter(c=>['id','user_id','created_at'].includes(c.name)):t.columns;
export function serviceMetadata(){
 const path=realpathSync(process.env.VELORA_STAGE2B_METADATA??'');
 const rel=relative(realpathSync('.'),path);if(!isAbsolute(rel)&&!rel.startsWith('..'))throw Error('METADATA_MUST_STAY_OUTSIDE_GIT');
 const raw=readFileSync(path,'utf8');if(createHash('sha256').update(raw).digest('hex')!=='e13e8f68799268d04822b4bc702d5f88adfeeacf1b3e8b46f6118a11a502d393')throw Error('SERVICE_METADATA_FINGERPRINT_CHANGED');
 const m=JSON.parse(raw);if(m.project!=='vmpifljyozsbtssxhoxd'||m.functions.length!==12||m.tables.length!==11)throw Error('WRONG_SERVICE_METADATA');return m;
}
export const functionQuery=signatures=>`SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY signature),'[]') FROM (SELECT p.oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,md5(replace(prosrc,chr(13),'')) body_md5,prosecdef,proconfig,provolatile,(SELECT jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) a) acl FROM pg_proc p WHERE p.oid IN (${signatures.map(s=>'to_regprocedure('+lit(s)+')').join(',')})) f;`;
export const relationQuery=tables=>`SELECT jsonb_object_agg(name,to_jsonb(t)) FROM (SELECT n.nspname||'.'||c.relname name,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,(SELECT jsonb_object_agg(a.attname,jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (n.nspname<>'auth' OR (c.relname='users' AND a.attname IN ('id','email','email_confirmed_at','phone_confirmed_at')) OR (c.relname='sessions' AND a.attname IN ('id','user_id','created_at')))) columns,(SELECT jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid IN (${tables.map(t=>'to_regclass('+lit(t)+')').join(',')})) t;`;
export const authNamespaceQuery="SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',(SELECT jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee::regrole::text,a.privilege_type) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) FROM pg_namespace n WHERE n.nspname='auth';";
export async function stage2Baseline(db,{installStage2=true}={}){
 await replay(db,metadata());await db.verify();const m=serviceMetadata(),defs=sourceDefinitions();
 const roles=(await db.sql('SELECT rolname FROM pg_roles ORDER BY rolname')).split('\n');const principals=['PUBLIC',...roles.map(q)].join(',');
 const current=json(await db.sql(relationQuery(m.tables.map(t=>t.name))));
 const commands=['BEGIN;SET LOCAL check_function_bodies=false;','ALTER SCHEMA auth OWNER TO '+q(m.auth_namespace.owner)+';','REVOKE ALL ON SCHEMA auth FROM '+principals+';'];
 for(const a of m.auth_namespace.acl)commands.push('GRANT '+a.privilege+' ON SCHEMA auth TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
 for(const f of m.functions){
  const def=f.definition??defs.find(d=>d.name===f.signature.split('(')[0]&&d.hash===f.body_md5)?.sql;
  if(!def)throw Error('SOURCE_EQUIVALENT_BODY_MISSING '+f.signature);
  commands.push(def.replace(/create\s+(?:or\s+replace\s+)?function/i,'CREATE OR REPLACE FUNCTION')+';','ALTER FUNCTION '+f.signature+' OWNER TO '+q(f.owner)+';','REVOKE ALL ON FUNCTION '+f.signature+' FROM '+principals+';');
  for(const a of f.acl)commands.push('GRANT '+a.privilege+' ON FUNCTION '+f.signature+' TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
 }
 // Peripheral Auth remains synthetic infrastructure. Align only the fields used by these exact guards.
 // Public/private supporting relations retain existing constraints/indexes; no historical financial DDL replay.
 for(const t of m.tables){
  for(const c of requiredColumns(t)){if(current[t.name]?.columns?.[c.name]?.type && current[t.name].columns[c.name].type!==c.type){if(!t.name.startsWith('auth.'))throw Error('SUPPORT_COLUMN_TYPE_DRIFT '+t.name+'.'+c.name);commands.push('ALTER TABLE '+t.name+' ALTER COLUMN '+q(c.name)+' TYPE '+c.type+' USING '+q(c.name)+'::'+c.type+';');}commands.push('ALTER TABLE '+t.name+' ADD COLUMN IF NOT EXISTS '+q(c.name)+' '+c.type+';','ALTER TABLE '+t.name+' ALTER COLUMN '+q(c.name)+(c.default?' SET DEFAULT '+c.default:' DROP DEFAULT')+';','ALTER TABLE '+t.name+' ALTER COLUMN '+q(c.name)+(c.notnull?' SET NOT NULL':' DROP NOT NULL')+';');}
  commands.push('ALTER TABLE '+t.name+' OWNER TO '+q(t.owner)+';','REVOKE ALL ON '+t.name+' FROM '+principals+';','ALTER TABLE '+t.name+(t.rls?' ENABLE':' DISABLE')+' ROW LEVEL SECURITY;','ALTER TABLE '+t.name+(t.force_rls?' FORCE':' NO FORCE')+' ROW LEVEL SECURITY;');
  for(const a of t.acl)commands.push('GRANT '+a.privilege+' ON '+t.name+' TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
 }
 commands.push('ALTER DATABASE g03_review OWNER TO postgres;REVOKE ALL ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role,postgres,pg_database_owner;GRANT USAGE ON SCHEMA public TO PUBLIC,anon,authenticated,service_role,postgres;GRANT USAGE,CREATE ON SCHEMA public TO pg_database_owner;SET LOCAL check_function_bodies=true;COMMIT;');
 await db.sql(commands.join('\n'));
 const legacy=await fixture(db);
 await db.sql('ALTER FUNCTION public.billing_create_test_checkout_order(jsonb,integer) OWNER TO postgres;REVOKE ALL ON FUNCTION public.billing_create_test_checkout_order(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.billing_create_test_checkout_order(jsonb,integer) TO service_role;');
 await db.sql('SET ROLE postgres;'+readFileSync('supabase/upgrade-packages/financial-proof-cloud/10-stage1.review.sql','utf8'));
 if(installStage2)await db.sql('SET ROLE postgres;'+readFileSync('supabase/upgrade-packages/financial-proof-cloud-stage2a/10-stage2a.review.sql','utf8'));
 return legacy;
}
export async function captureBaseline(db,path){
 const s1=JSON.parse(readFileSync('supabase/upgrade-packages/financial-proof-cloud/manifest.json','utf8')),s2=JSON.parse(readFileSync('supabase/upgrade-packages/financial-proof-cloud-stage2a/manifest.json','utf8')),m=serviceMetadata();
 const originals=readFileSync('supabase/upgrade-packages/financial-proof-cloud-stage2a/preflight.readonly.sql','utf8');
 const signatures=[...new Set([...Object.keys(s1.functions),...s1.fixture_dependencies.map(f=>f.signature),...s2.baseline_live_functions.map(f=>f.signature),...m.functions.map(f=>f.signature),'private.billing_settle_payment_core_pre_acceptance(jsonb)','private.billing_acceptance_hmac_event(jsonb)','private.billing_payment_attempts_sync_order_scope()','private.billing_payment_attempts_binding_guard()','private.billing_order_deadline_identity_guard()','private.billing_provider_event_binding_guard()','private.billing_record_lifecycle_review(public.billing_provider_events,uuid,text)','private.billing_apply_reversal(uuid,uuid,uuid,text,jsonb)','public.billing_read_company_operational_entitlement(uuid)'])];
 const query=originals.replace(/where p.oid in\(.*?\)\)\) select/s,'where p.oid in('+signatures.map(s=>'to_regprocedure('+lit(s)+')').join(',')+')) select');
 const baseline=json(await db.sql(query));baseline.functions=JSON.parse(await db.sql("BEGIN READ ONLY;SET LOCAL search_path='';"+functionQuery(signatures)+'COMMIT;'));baseline.service_relations=json(await db.sql("BEGIN READ ONLY;SET LOCAL search_path='';"+relationQuery(m.tables.map(t=>t.name))+'COMMIT;'));
 baseline.auth_namespace=json(await db.sql(authNamespaceQuery));
 for(const k of Object.keys(m.auth_namespace))if(JSON.stringify(baseline.auth_namespace[k])!==JSON.stringify(m.auth_namespace[k]))throw Error('AUTH_NAMESPACE_DRIFT '+k);
 for(const f of m.functions){const expected={...f};delete expected.definition;if(JSON.stringify(baseline.functions.find(x=>x.signature===f.signature))!==JSON.stringify(expected)){
  const actual=baseline.functions.find(x=>x.signature===f.signature);for(const k of Object.keys(expected))if(JSON.stringify(actual?.[k])!==JSON.stringify(expected[k]))throw Error('SERVICE_FUNCTION_DRIFT '+f.signature+' '+k);
 }}
 if(path)writeFileSync(path,JSON.stringify(baseline,null,2)+'\n');return baseline;
}
