// Actual migrated RPC bodies on disposable PostgreSQL. Auth/context are labelled
// dependency doubles: this is allowance/locking proof, NOT hosted RLS acceptance.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile), name=`velora-hours-${randomUUID().slice(0,8)}`, image='postgres:17.6-alpine';
const a='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',b='33333333-3333-4333-8333-333333333333';
let id;
async function sql(query){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['exec','-i',id,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));child.stdin.end("set statement_timeout='10s';set lock_timeout='5s';"+query);
});}
try{
 await exec('docker',['image','inspect',image],{windowsHide:true});
 id=(await exec('docker',['run','--detach','--name',name,'--label','velora.task=hours-exceptions','--network','none','--log-driver','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','--memory','256m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image],{windowsHide:true})).stdout.trim();
 let ready=false;for(let n=0;n<30;n++){try{await sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,200));}}assert(ready,'POSTGRES_READY');

 await sql(`create schema private;create role anon;create role authenticated;
 create table public.company_branches(id uuid primary key, company_id uuid, name text, timezone text);
 create table private.es02_branch_hours(company_id uuid,branch_id uuid,schedule jsonb,revision bigint,updated_at timestamptz,primary key(company_id,branch_id));
 create table private.es02_branch_hours_receipts(company_id uuid,branch_id uuid,revision bigint,fingerprint text,unique(company_id,branch_id,revision));
 -- Explicit dependency double; not native Auth/RLS acceptance.
 create function public.es02_read_owned_branch_setup(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('ok',$1='${a}'::uuid and $2='${c}'::uuid and $3='${b}'::uuid,'code','NOT_OWNED')$$;
 insert into public.company_branches values('${b}','${c}','Fixture','Asia/Muscat');`);
 const baseline=await readFile('supabase/migrations/20261020153000_es02_b4_branch_hours.sql','utf8');
 const begin=baseline.indexOf('create or replace function public.es02_save_owned_branch_hours(');
 await sql(baseline.slice(begin,baseline.indexOf('$$;',baseline.indexOf('as $$',begin))+3));
 const candidate=await readFile('supabase/migrations/20261028171440_es02_hours_date_exceptions.sql','utf8');
 await sql(candidate);
 const signature='public.es02_save_owned_branch_hours(uuid,uuid,uuid,bigint,jsonb)';
 await sql(`revoke all on function ${signature} from public,anon;grant execute on function ${signature} to authenticated;`);
 const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
 const week=Object.fromEntries(days.map(day=>[day,{state:'closed'}]));
 const schedule={...week,exceptions:[{date:'2028-02-29',hours:{state:'closed'}}]};
 const lit=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
 const valid=x=>sql(`select private.es02_validate_branch_hours_schedule(${lit(x)})`);
 assert.equal(await valid(week),'t');assert.equal(await valid(schedule),'t');
 const interval=(start,end,nextDay=false)=>({state:'open',intervals:[{start,end,nextDay}]});
 for(const exceptions of [null,{},[{date:'2026-02-29',hours:{state:'closed'}}],[schedule.exceptions[0],schedule.exceptions[0]],[{date:'2026-12-01',hours:{state:'unset'}}],[{date:'2026-12-01',hours:interval('22:00','02:00',true)}],[{date:'2026-12-01',hours:{state:'open',intervals:[{start:'09:00',end:'13:00',nextDay:false},{start:'12:00',end:'15:00',nextDay:false}]}}]]) assert.equal(await valid({...week,exceptions}),'f');
 for(const start of ['00:00','22:00']) assert.equal(await valid({...week,exceptions:[{date:'2026-12-01',hours:interval(start,'00:00',true)}]}),'t');
 const save=(s,revision,account=a,company=c,branch=b)=>`select public.es02_save_owned_branch_hours('${account}','${company}','${branch}',${revision},${lit(s)})`;
 await assert.rejects(sql(`set role anon;${save(schedule,0)}`),/permission denied/);
 const first=JSON.parse(await sql(`set role authenticated;${save(schedule,0)}`));assert.equal(first.ok,true);assert.deepEqual(first.data.snapshot.schedule,schedule);
 assert.equal(JSON.parse(await sql(`set role authenticated;${save(schedule,0)}`)).data.snapshot.version,1);
 const changed={...week,exceptions:[{date:'2026-12-01',hours:interval('09:00','13:00')}]};
 assert.equal(JSON.parse(await sql(`set role authenticated;${save(changed,0)}`)).code,'CONFLICT');
 for(const args of [[c,c,b],[a,a,b],[a,c,c]]) assert.equal(JSON.parse(await sql(`set role authenticated;${save(changed,1,...args)}`)).ok,false);
 const concurrent=await Promise.all([changed,{...week,exceptions:[]}].map(s=>sql(`set role authenticated;${save(s,1)}`).then(JSON.parse)));
 assert.equal(concurrent.filter(x=>x.ok===true).length,1);assert.equal(concurrent.filter(x=>x.code==='CONFLICT').length,1);
 assert.equal(await sql('select revision from private.es02_branch_hours'),'2');
 await sql(candidate);
 await assert.rejects(sql(`set role anon;${save(schedule,2)}`),/permission denied/);
 console.log('PASS native SQL: valid/invalid exception dates, overlap and overnight denial; actual unchanged save RPC round-trip/replay/CAS/concurrent winner; scoped dependency denial; ACL preserved. Auth/RLS dependency doubled, hosted acceptance NOT_RUN.');
}finally{
 if(id){const state=JSON.parse((await exec('docker',['inspect',id],{windowsHide:true})).stdout)[0];assert.equal(state.Config.Labels['velora.task'],'hours-exceptions');assert.equal(state.HostConfig.NetworkMode,'none');assert.equal(state.Name,'/'+name);assert(state.Mounts.every(x=>x.Type==='tmpfs'));await exec('docker',['rm','--force',id],{windowsHide:true});}
}
