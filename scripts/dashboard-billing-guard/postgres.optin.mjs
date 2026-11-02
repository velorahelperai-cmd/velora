import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
if(process.env.DASHBOARD_BILLING_GUARD_TESTS!=='1')throw Error('OPT_IN_REQUIRED');
const container=process.env.DASHBOARD_BILLING_GUARD_CONTAINER,database='f48_billing';
if(!container||!/^velora-f48-billing-[a-z0-9-]+$/.test(container))throw Error('INVALID_ISOLATE');
const d=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:60000});
const info=JSON.parse(d(['inspect',container]))[0];
if(info.Config.Labels['velora.task']!=='f48-billing-null'||info.HostConfig.NetworkMode!=='none'||Object.keys(info.HostConfig.PortBindings??{}).length)throw Error('WRONG_TARGET');
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=s=>d(['exec','-i','-u','postgres',container,'psql','-X','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],"SET statement_timeout='15s';\n"+s);
const baselineSource=readFileSync('supabase/upgrade-packages/outbound-usage-display/10-display-compatibility.review.sql','utf8').replaceAll('\r\n','\n');
const original=baselineSource.match(/CREATE OR REPLACE FUNCTION public\.billing_read_company_display_evidence[\s\S]*?end;\$function\$/)?.[0];
if(!original)throw Error('BASELINE_MISSING');
const baseline=original+';ALTER FUNCTION public.billing_read_company_display_evidence(uuid) OWNER TO postgres;REVOKE ALL ON FUNCTION public.billing_read_company_display_evidence(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION public.billing_read_company_display_evidence(uuid) TO authenticated;';
const upgrade=readFileSync('supabase/migrations/20261102064655_dashboard_billing_null_proof_guard.sql','utf8');
sql(baseline);
const u=randomUUID(),s=randomUUID(),c=randomUUID(),p=randomUUID(),v=randomUUID();
sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${u}','f48-local@example.invalid',now());
 INSERT INTO auth.sessions(id,user_id,created_at) VALUES('${s}','${u}',now());
 INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES('${s}','${u}',now()-interval '1 second');
 INSERT INTO public.companies(id,display_name,status,created_by) VALUES('${c}','F48 synthetic','active','${u}');
 INSERT INTO public.company_members(company_id,user_id,role,status) VALUES('${c}','${u}','owner','active');
 INSERT INTO public.billing_plans(id,code,name,status) VALUES('${p}','f48_${p}','Synthetic','active');
 INSERT INTO public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits) VALUES('${v}','${p}',1,45000,'OMR',30,'month',1,'draft','{}');`);
const auth=`SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"='${u}';SET LOCAL "request.jwt.claims"='${JSON.stringify({sub:u,session_id:s,role:'authenticated'})}';`;
const cases=[];
for(const kind of ['absent','both-null','plan-null','period-null','populated','foreign-company','wrong-session']){
 const seed=kind==='absent'?'':`INSERT INTO public.billing_subscriptions(company_id,environment,status,plan_version_id,paid_through) VALUES('${c}','live','active',${['both-null','plan-null'].includes(kind)?'null':q(v)},${['both-null','period-null'].includes(kind)?'null':"'2099-01-01T00:00:00Z'"});`;
 const scope=kind==='foreign-company'?randomUUID():c;
 const read=`BEGIN;${seed}${auth}${kind==='wrong-session'?`SET LOCAL "request.jwt.claims"='${JSON.stringify({sub:u,session_id:randomUUID(),role:'authenticated'})}';`:''}SELECT public.billing_read_company_display_evidence('${scope}');ROLLBACK;`;
 sql(baseline);const before=sql(read);sql(upgrade);const after=sql(read);
 // Subscription UUID is generated per rolled-back fixture, exclude only that id.
 const clean=x=>{const a=JSON.parse(x);if(a.data?.journey?.subscription)delete a.data.journey.subscription.id;return a;};
 if(JSON.stringify(clean(before))!==JSON.stringify(clean(after)))throw Error('PARITY_FAILED:'+kind);
 const result=clean(after);
 if(['foreign-company','wrong-session'].includes(kind)){if(result.ok!==false||result.code!=='forbidden')throw Error('DENIAL_FAILED:'+kind);}
 else if(result.ok!==true||result.data.billing_paid!==false||result.data.operational_eligible!==false)throw Error('READ_FAILED:'+kind+':'+JSON.stringify(result));
 cases.push({kind,passed:true});console.log('PASS '+kind);
}
const installed=sql("SELECT prosrc FROM pg_proc WHERE oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;");
const originalBody=original.split('$function$')[1].trim();
const unwrapped=installed.replace(" if s.id is null or s.plan_version_id is null or s.paid_through is null then\n  current_proof:=false;\n  bound:=false;\n else\n",'').replace('\n end if;\n eligible:=','\n eligible:=').trim();
if(unwrapped!==originalBody)throw Error('NON_GUARD_BODY_CHANGED');
cases.push({kind:'all-other-predicates-byte-identical',passed:true});
try{sql(upgrade);throw Error('REPLAY_ACCEPTED');}catch(e){if(!String(e).includes('DASHBOARD_BILLING_GUARD_PREREQUISITE_DRIFT'))throw e;}
cases.push({kind:'replay-rejected',passed:true});
sql(baseline+"GRANT EXECUTE ON FUNCTION public.billing_read_company_display_evidence(uuid) TO anon;");
try{sql(upgrade);throw Error('ACL_DRIFT_ACCEPTED');}catch(e){if(!String(e).includes('DASHBOARD_BILLING_GUARD_PREREQUISITE_DRIFT'))throw e;}
sql(baseline);sql(upgrade);
cases.push({kind:'acl-drift-rejected',passed:true});
const acl=JSON.parse(sql("SELECT jsonb_build_object('acl',proacl::text,'config',proconfig,'definer',prosecdef,'owner',pg_get_userbyid(proowner)) FROM pg_proc WHERE oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;"));
if(acl.acl!=='{postgres=X/postgres,authenticated=X/postgres}'||JSON.stringify(acl.config)!==JSON.stringify(['search_path=""'])||acl.definer!==true||acl.owner!=='postgres')throw Error('AUTHORITY_CHANGED');
cases.push({kind:'owner-acl-security-searchpath-preserved',passed:true});
if(process.env.DASHBOARD_BILLING_GUARD_PROOF)writeFileSync(process.env.DASHBOARD_BILLING_GUARD_PROOF,JSON.stringify({cases,customerDataCopied:0,providerCalls:0,scope:'Native display RPC parity on isolated schema; no positive paid receipt fixture'},null,2));
console.log(JSON.stringify({passed:cases.length}));
