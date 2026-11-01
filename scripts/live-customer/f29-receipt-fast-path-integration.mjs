import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// Native relational equivalence fixture only, no hosted/project credentials.
const container='velora-f29-'+randomUUID().slice(0,8);
const dockerEnv=Object.fromEntries(['PATH','Path','SystemRoot','SYSTEMROOT','SystemDrive','COMSPEC','PATHEXT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','DOCKER_CONFIG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,env:dockerEnv});
const started=run(['run','--detach','--pull=never','--name',container,'--label','velora.task=f29-receipt','--network','none','--memory','512m','--cpus','1','--log-driver','none','-e','POSTGRES_PASSWORD=local-fixture-only','supabase/postgres:17.6.1.136','postgres','-D','/etc/postgresql','-c','cron.launch_active_jobs=off','-c','shared_buffers=32MB']);
if(started.status!==0)throw Error('F29_LOCAL_CONTAINER_START_FAILED');
try {
 const deadline=Date.now()+45000;
 while(run(['exec',container,'pg_isready','-U','postgres']).status!==0){if(Date.now()>deadline)throw Error('F29_LOCAL_POSTGRES_NOT_READY');await new Promise(r=>setTimeout(r,400));}

const sql=s=>{const r=run(['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1'],s);if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;};
const original=`
 select jsonb_build_object('receiptId',g.id,'subscriptionId',s.id,'expiredAt',g.applied_paid_through)
 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id
 where s.company_id=cid and s.environment='live' and g.provider_environment='live'
 and s.plan_version_id=g.plan_version_id
 and isfinite(s.paid_through) and s.paid_through=g.applied_paid_through
 order by g.applied_paid_through desc,g.applied_at desc,g.id desc limit 1
`;
const fixture=`create schema if not exists private;
create table public.billing_subscriptions(id uuid,company_id uuid,environment text,plan_version_id uuid,paid_through timestamptz);
create table private.f29_grants(id uuid,subscription_id uuid,company_id uuid,plan_version_id uuid,provider_environment text,applied_paid_through timestamptz,applied_at timestamptz);
create view private.billing_proven_entitlement_grants as select * from private.f29_grants;
create function private.billing_lifecycle_receipt(cid uuid) returns jsonb language sql stable security definer set search_path to '' as $original$${original}$original$;
revoke all on function private.billing_lifecycle_receipt(uuid) from public,anon,authenticated,service_role;
insert into public.billing_subscriptions select md5('s'||i)::uuid,md5('c'||(i%100))::uuid,case when i%5=0 then 'test' else 'live' end,md5('p'||(i%3))::uuid,case i%7 when 0 then null when 1 then 'infinity'::timestamptz when 2 then '-infinity'::timestamptz else '2026-10-01'::timestamptz+i*interval '1 day' end from generate_series(1,400)i;
insert into private.f29_grants select md5('g'||i)::uuid,s.id,case when i%11=0 then md5('foreign')::uuid else s.company_id end,case when i%13=0 then md5('wrongplan')::uuid else s.plan_version_id end,case when i%17=0 then 'test' else 'live' end,case when i%19=0 then s.paid_through+interval '1 day' else s.paid_through end,'2026-09-01'::timestamptz+i*interval '1 hour' from generate_series(1,400)i join public.billing_subscriptions s on s.id=md5('s'||i)::uuid where i%23<>0;
create table private.f29_baseline as select cid,private.billing_lifecycle_receipt(cid) receipt from(select md5('c'||i)::uuid cid from generate_series(0,105)i union all select null::uuid)x;
create table private.f29_catalog as select proowner,proacl,proconfig,prosecdef,provolatile from pg_proc where oid='private.billing_lifecycle_receipt(uuid)'::regprocedure;
`;
console.log(sql(fixture).trim().split('\n').slice(-3).join('\n'));
const migration=readFileSync('supabase/migrations/20261101225642_billing_receipt_empty_candidate_fast_path.sql','utf8').replace(/^\uFEFF/,'');
console.log(sql(migration));console.log(sql(migration));
console.log(sql(`do $$begin
 if exists(select 1 from private.f29_baseline where receipt is distinct from private.billing_lifecycle_receipt(cid)) then raise exception 'F29_RECEIPT_CHANGED';end if;
 if not exists(select 1 from pg_proc p cross join private.f29_catalog b where p.oid='private.billing_lifecycle_receipt(uuid)'::regprocedure and p.proowner=b.proowner and p.proacl is not distinct from b.proacl and p.proconfig is not distinct from b.proconfig and p.prosecdef=b.prosecdef and p.provolatile=b.provolatile) then raise exception 'F29_AUTHORITY_CHANGED';end if;
 if has_function_privilege('authenticated','private.billing_lifecycle_receipt(uuid)','EXECUTE') or has_function_privilege('anon','private.billing_lifecycle_receipt(uuid)','EXECUTE') then raise exception 'F29_PRIVILEGE_ESCALATION';end if;
end $$;
select count(*) as cases,count(*) filter(where receipt is not null) as proven_receipts from private.f29_baseline;`));
console.log('PASS: 107 native equivalence cases, finite/null/infinite/absent/unproven/foreign-company/plan/environment/paid-through mismatches, receipt ordering, ACL/owner/search_path/stability/security preserved, idempotent replay. Fixture proof view is synthetic; not full financial-chain acceptance.');


} finally { run(['stop','-t','1',container]); console.log('Local fixture stopped: '+container); }
