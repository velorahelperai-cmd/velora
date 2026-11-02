import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container='velora-f40-'+randomUUID().slice(0,8);
const dockerEnv=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','DOCKER_CONFIG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,env:dockerEnv});
if(run(['run','--detach','--pull=never','--name',container,'--label','velora.task=f40-send','--network','none','--memory','512m','--cpus','1','--log-driver','none','-e','POSTGRES_PASSWORD=local-fixture-only','supabase/postgres:17.6.1.136','postgres','-D','/etc/postgresql','-c','cron.launch_active_jobs=off','-c','shared_buffers=32MB']).status!==0)throw Error('F40_CONTAINER_FAILED');
try {
 const deadline=Date.now()+45000;
 while(run(['exec',container,'pg_isready','-U','postgres']).status!==0){if(Date.now()>deadline)throw Error('F40_POSTGRES_NOT_READY');await new Promise(r=>setTimeout(r,400));}
 const sql=s=>{const r=run(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],s);if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;};
 const original="CREATE OR REPLACE FUNCTION private.billing_chat_send(cid uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n select case when private.billing_lifecycle_receipt(cid) is null then\n  not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null)\n else exists(select 1 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id and g.plan_version_id=s.plan_version_id\n  where s.company_id=cid and s.environment='live' and g.provider_environment='live' and s.paid_through=g.applied_paid_through\n   and s.status in ('active','cancel_at_period_end') and g.applied_paid_through>statement_timestamp() and private.billing_service_receipt_eligible(g.id)) end\n$function$\n;";
 sql(`create schema if not exists private;
 create table public.billing_subscriptions(id uuid,company_id uuid,environment text,plan_version_id uuid,paid_through timestamptz,status text);
 create table private.f40_grants(id uuid,subscription_id uuid,company_id uuid,plan_version_id uuid,provider_environment text,applied_paid_through timestamptz,eligible boolean);
 create view private.billing_proven_entitlement_grants as select * from private.f40_grants;
 create table private.f40_cases(cid uuid,label text,receipt jsonb,expected boolean);
 create function private.billing_lifecycle_receipt(cid uuid) returns jsonb language sql stable as 'select receipt from private.f40_cases where f40_cases.cid=$1';
 create function private.billing_service_receipt_eligible(gid uuid) returns boolean language sql stable as 'select eligible from private.f40_grants where id=$1';
 `+original+`
 revoke all on function private.billing_chat_send(uuid) from public,anon,authenticated,service_role;
 -- Full Cartesian truth table: receipt, environment, status, dates and proof mismatches.
 insert into private.f40_cases
 select md5('c'||i)::uuid,concat_ws('/',receipt,env,status,dt,mismatch),
 case when receipt then '{}'::jsonb else null end,
 case when not receipt then env<>'live' or dt='null'
 else env='live' and status in ('active','cancel_at_period_end') and dt in ('future','infinity') and mismatch='valid' end
 from (
 select row_number() over() i,receipt,env,status,dt,mismatch
 from unnest(array[false,true]) receipt
 cross join unnest(array['live','test']) env
 cross join unnest(array['active','cancel_at_period_end','expired','pending']) status
 cross join unnest(array['null','future','past','infinity','-infinity']) dt
 cross join unnest(array['valid','no_grant','company','plan','subscription','provider','paid_through','ineligible','eligibility_null']) mismatch
 ) x;
 insert into public.billing_subscriptions
 select cid,cid,split_part(label,'/',2),md5('plan')::uuid,
 case split_part(label,'/',4) when 'null' then null when 'future' then statement_timestamp()+interval '10 days' when 'past' then statement_timestamp()-interval '10 days' when 'infinity' then 'infinity'::timestamptz else '-infinity'::timestamptz end,
 split_part(label,'/',3) from private.f40_cases;
 insert into private.f40_grants
 select s.id,case when split_part(c.label,'/',5)='subscription' then md5('wrong')::uuid else s.id end,
 case when split_part(c.label,'/',5)='company' then md5('foreign')::uuid else s.company_id end,
 case when split_part(c.label,'/',5)='plan' then md5('wrongplan')::uuid else s.plan_version_id end,
 case when split_part(c.label,'/',5)='provider' then 'test' else 'live' end,
 case when split_part(c.label,'/',5)='paid_through' then statement_timestamp()+interval '20 days' else s.paid_through end,
 case split_part(c.label,'/',5) when 'ineligible' then false when 'eligibility_null' then null else true end
 from public.billing_subscriptions s join private.f40_cases c on c.cid=s.company_id where split_part(c.label,'/',5)<>'no_grant';
 insert into private.f40_cases values (md5('absent')::uuid,'absent',null,true),(md5('receipt_without_subscription')::uuid,'receipt_without_subscription','{}',false),(null,'null_company',null,true);
 create table private.f40_baseline as select *,private.billing_chat_send(cid) actual from private.f40_cases;
 do $$begin if exists(select 1 from private.f40_baseline where actual is distinct from expected) then raise exception 'F40_BASELINE_ORACLE_MISMATCH';end if;end $$;
 create table private.f40_catalog as select proowner,proacl,proconfig,prosecdef,provolatile from pg_proc where oid='private.billing_chat_send(uuid)'::regprocedure;
 `);
 const migration=readFileSync('supabase/migrations/20261102041539_billing_send_lazy_paid_proof.sql','utf8').replace(/^\uFEFF/,'');
 sql(migration);sql(migration);
 console.log(sql(`do $$begin
 if exists(select 1 from private.f40_baseline where actual is distinct from private.billing_chat_send(cid)) then raise exception 'F40_DECISION_CHANGED';end if;
 if not exists(select 1 from pg_proc p cross join private.f40_catalog b where p.oid='private.billing_chat_send(uuid)'::regprocedure and p.proowner=b.proowner and p.proacl is not distinct from b.proacl and p.proconfig is not distinct from b.proconfig and p.prosecdef=b.prosecdef and p.provolatile=b.provolatile) then raise exception 'F40_AUTHORITY_CHANGED';end if;
 if has_function_privilege('authenticated','private.billing_chat_send(uuid)','EXECUTE') or has_function_privilege('anon','private.billing_chat_send(uuid)','EXECUTE') or has_function_privilege('service_role','private.billing_chat_send(uuid)','EXECUTE') then raise exception 'F40_PRIVILEGE_ESCALATION';end if;
 end $$;
 select count(*) cases,count(*) filter(where actual) allowed from private.f40_baseline;`));
 console.log('PASS: native decision equivalence + independent truth table, catalog/ACL preserved, replay twice. Synthetic proof fixture; not full billing-chain or delivery acceptance.');
} finally {run(['stop','-t','1',container]);console.log('Stopped '+container);}
