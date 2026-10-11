import {test,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {bootstrap,sql,session,lit,file} from "./postgres.mjs";
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner=id(1),ma=id(2),mb=id(3),ea=id(4),eb=id(5),finance=id(6),outsider=id(7),unverified=id(8),a=id(101),b=id(102),company=id(201);
let operation=1000;
const auth=(actor=owner,extra={})=>`set role authenticated;select set_config('request.jwt.claims',${lit(JSON.stringify({sub:actor,session_id:id(Number(actor.slice(-12))+500),exp:Math.floor(Date.now()/1000)+3600,...extra}))},false);`;
const parse=output=>JSON.parse(output.split("\n").at(-1));
const read=async(actor,name,args="",extra={})=>parse(await sql(`${auth(actor,extra)}select public.${name}(${args});`));
const waitBlocked=async operationId=>{
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){
  if(Number(await sql(`select count(*)from pg_stat_activity where datname=current_database()and wait_event_type='Lock'and position(${lit(operationId)}in query)>0`)))return;
  await new Promise(r=>setTimeout(r,20));
 }
 throw Error("SYNTHETIC_MUTATION_DID_NOT_WAIT_FOR_LOCK");
};
const payload=(op,fields={})=>({op,operation_id:id(operation++),reason:"Synthetic owner change",...fields});
const mutate=(input,actor=owner)=>read(actor,"platform_team_mutate",`${lit(JSON.stringify(input))}::jsonb`);
const directory=(actor,team=null,cursor=null,pageSize=25,search="")=>read(actor,"platform_team_read_directory",`${team?lit(team):"null"}::uuid,${cursor?lit(cursor.id):"null"}::uuid,${cursor?cursor.revision:"null"},${pageSize},${lit(search)},${cursor?lit(JSON.stringify({actor_user_id:cursor.actor_user_id,team_id:cursor.team_id,search:cursor.search,scope_revision:cursor.scope_revision}))+"::jsonb":"null"}`);
const revision=async(team)=>Number(await sql(`select revision from public.platform_teams where id=${lit(team)}`));
const memberRevision=async(team,user)=>Number(await sql(`select coalesce((select revision from public.platform_team_members where team_id=${lit(team)} and user_id=${lit(user)}),0)`));
const setMember=async(team,user,status="active")=>mutate(payload("set_member",{team_id:team,user_id:user,status,expected_team_revision:await revision(team),expected_member_revision:await memberRevision(team,user)}));
const transferInput=async(user=ea)=>payload("transfer",{source_team_id:a,destination_team_id:b,user_id:user,expected_source_revision:await revision(a),expected_destination_revision:await revision(b),expected_member_revision:await memberRevision(a,user),expected_destination_member_revision:await memberRevision(b,user)});
before(async()=>{await bootstrap();if(process.argv.includes("--red"))return;await file("supabase/upgrade-packages/platform-teams/10-teams.review.sql");});
beforeEach(async()=>{
 if(process.argv.includes("--red"))return;
 await sql(`truncate private.platform_team_operations,public.platform_team_members,public.platform_teams,public.admin_audit_logs,public.company_member_grants,public.company_members,public.platform_admin_scopes,public.platform_admins,public.profiles,private.app_session_activity,auth.sessions,auth.users,public.companies cascade;
 insert into auth.users(id,email,email_confirmed_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'synthetic-'||n||'@example.invalid',case when n=8 then null else now() end from generate_series(1,8)n;
 insert into auth.sessions(id,user_id) select ('00000000-0000-4000-8000-'||lpad((n+500)::text,12,'0'))::uuid,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,8)n;
 insert into private.app_session_activity(session_id,user_id,last_activity_at)select id,user_id,clock_timestamp()from auth.sessions;
 insert into public.profiles select id,'Synthetic '||right(id::text,1),'SYNTHETIC' from auth.users;
 insert into public.platform_admins(user_id,role,status) values (${lit(owner)},'owner','active'),(${lit(finance)},'delegated','active'),(${lit(ma)},'delegated','active'),(${lit(mb)},'delegated','active');
 insert into public.companies values(${lit(company)});
 insert into public.platform_admin_scopes(admin_user_id,company_id,usable_capabilities,delegable_capabilities)values(${lit(finance)},${lit(company)},array['platform.view_audit'],'{}');
 insert into public.company_members values(${lit(company)},${lit(ea)},'staff','active');
 insert into public.company_member_grants values(${lit(company)},${lit(ea)},array['knowledge.read'],${lit(finance)},'active',7);`);
 for(const [team,manager,name]of[[a,ma,"Team A"],[b,mb,"Team B"]])assert.equal((await mutate(payload("create",{team_id:team,name,manager_user_id:manager,expected_team_revision:0}))).ok,true);
 assert.equal((await setMember(a,ea)).ok,true);assert.equal((await setMember(b,eb)).ok,true);
});
if(process.argv.includes("--red")){
 test("verified team self-read contract exists before any UI is exposed",async()=>{await assert.doesNotReject(()=>read(owner,"platform_team_read_self"));});
}else{
 test("owner sees two teams; managers see only their own counts, rows and cursor scope",async()=>{
  const all=await directory(owner);assert.equal(all.total,2);assert.equal(all.rows.length,2);
  assert.equal((await directory(owner,null,null,25,"Team B")).total,1);assert.equal((await directory(ma,null,null,25,"Team B")).total,0);assert.equal((await directory(ma,id(999))).code,"FORBIDDEN");
  const teams=await directory(ma);assert.equal(teams.total,1);assert.equal(teams.rows[0].id,a);assert.equal(teams.rows[0].member_count,2);
  const page=await directory(ma,a,null,1);assert.equal(page.total,2);assert.equal(page.rows.length,1);assert.ok(page.next_cursor);
  const next=await directory(ma,a,page.next_cursor,1);assert.equal(next.rows.length,1);assert.notEqual(next.rows[0].user_id,page.rows[0].user_id);
  assert.equal((await directory(ma,b)).code,"FORBIDDEN");assert.equal((await directory(ma,a,{id:eb,revision:1})).code,"INVALID_INPUT");
  assert.equal((await directory(ma,null,{id:b,revision:1})).code,"INVALID_INPUT");
 });
 test("employees read only self/manager; finance scopes and outsiders grant no directory authority",async()=>{
  const self=await read(ea,"platform_team_read_self");assert.equal(self.memberships[0].membership.user_id,ea);assert.equal(self.memberships[0].manager.user_id,ma);assert.equal("rows"in self,false);assert.equal("member_count"in self.memberships[0].team,false);
  for(const actor of[ea,finance,outsider])assert.equal((await directory(actor,a)).code,"FORBIDDEN");
  assert.deepEqual((await read(outsider,"platform_team_read_self")).memberships,[]);
  assert.equal((await read(ma,"platform_team_read_self")).memberships[0].manager,null);
 });
 test("table RLS limits direct reads and all browser direct writes are denied",async()=>{
  assert.equal(await sql(`${auth(ea)}select count(*) from public.platform_team_members` ).then(o=>o.split("\n").at(-1)),"1");
  assert.equal(await sql(`${auth(ma)}select count(*) from public.platform_team_members` ).then(o=>o.split("\n").at(-1)),"2");
  for(const statement of[`update public.platform_teams set name='No'`,`insert into public.platform_team_members(team_id,user_id) values('${a}','${outsider}')`,`delete from public.platform_team_members`,`select * from private.platform_team_operations`])await assert.rejects(()=>sql(`${auth(owner)}${statement}`),/permission denied/);
  await assert.rejects(()=>sql(`set role anon;select public.platform_team_read_self()`),/permission denied/);
 });
 test("manager self-promotion, forged revisions and unverified enrollment fail without side effects",async()=>{
  const request=payload("set_member",{team_id:b,user_id:ea,status:"active",expected_team_revision:1,expected_member_revision:0});assert.equal((await mutate(request,ma)).code,"FORBIDDEN");
  assert.equal((await mutate({...request,team_id:a,expected_team_revision:0})).code,"CONFLICT");
  assert.equal((await setMember(a,unverified)).code,"INVALID_MEMBER");assert.equal((await setMember(b,ea)).ok,true);
  const self=await read(ea,"platform_team_read_self");assert.equal(self.memberships[0].team.id,a);
 });
 test("manager replacement revokes roster and disables/transfers require replacing current manager first",async()=>{
  assert.equal((await setMember(a,ma,"disabled")).code,"MANAGER_REQUIRED");
  assert.equal((await mutate(await transferInput(ma))).code,"MANAGER_REQUIRED");
  await sql(`insert into public.platform_admins(user_id,role,status)values('${ea}','delegated','active')`);
  const update=payload("update",{team_id:a,name:"Team A",status:"active",manager_user_id:ea,expected_team_revision:await revision(a)});
  assert.equal((await mutate(update)).ok,true);assert.equal((await directory(ma,a)).code,"FORBIDDEN");
  assert.equal((await read(ma,"platform_team_read_self")).memberships[0].manager.user_id,ea);assert.equal((await read(ea,"platform_team_read_self")).memberships[0].manager,null);
  assert.equal((await directory(ea,a)).total,2);
  assert.equal((await mutate(payload("update",{...update,status:"disabled",manager_user_id:null,expected_team_revision:await revision(a),operation_id:id(operation++)}))).ok,true);
  assert.equal((await directory(ea,a)).code,"FORBIDDEN");assert.equal((await read(ea,"platform_team_read_self")).memberships[0].access,"denied");
 });
 test("preview and atomic transfer preserve unrelated internal rows, company grants and finance separation",async()=>{
  assert.equal((await setMember(b,ea,"disabled")).ok,true);
  const grants=await sql("select jsonb_agg(to_jsonb(g)) from public.company_member_grants g");
  const scopes=await sql("select jsonb_agg(to_jsonb(g)) from public.platform_admin_scopes g");
  const request=await transferInput();const preview=await read(owner,"platform_team_preview_transfer",`${lit(JSON.stringify(request))}::jsonb`);assert.equal(preview.ok,true);assert.equal(preview.manager_after.user_id,mb);
  assert.equal((await mutate(request)).ok,true);assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,b);
  assert.equal(await sql(`select status from public.platform_team_members where team_id='${a}' and user_id='${ea}'`),"disabled");
  assert.equal(await sql("select jsonb_agg(to_jsonb(g)) from public.company_member_grants g"),grants);assert.equal(await sql("select jsonb_agg(to_jsonb(g)) from public.platform_admin_scopes g"),scopes);
  assert.equal(await sql(`select count(*) from public.platform_admins where user_id='${ea}'`),"0");assert.equal((await directory(ea,b)).code,"FORBIDDEN");
 });
 test("exact replay returns confirmed result once; changed payload or revoked owner cannot replay",async()=>{
  const request=await transferInput();const first=await mutate(request);const second=await mutate(request);assert.deepEqual(second,first);
  assert.equal(await sql(`select count(*) from public.admin_audit_logs where action='platform.team.transfer'`),"1");
  assert.equal((await mutate({...request,reason:"Changed reason"})).code,"OPERATION_CONFLICT");
  await sql(`update public.platform_admins set status='disabled' where user_id='${owner}'`);assert.equal((await mutate(request)).code,"FORBIDDEN");
 });
 test("audit failure rolls membership changes and replay ledger back together",async()=>{
  const request=await transferInput();await sql(`create or replace function private.test_fail_team_audit()returns trigger language plpgsql as $$begin if new.action='platform.team.transfer' then raise exception 'SYNTHETIC_AUDIT_FAILURE';end if;return new;end;$$;create trigger team_audit_failure before insert on public.admin_audit_logs for each row execute function private.test_fail_team_audit();`);
  try{await assert.rejects(()=>mutate(request),/SYNTHETIC_AUDIT_FAILURE/);assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);assert.equal(await sql(`select count(*) from private.platform_team_operations where operation_id='${request.operation_id}'`),"0");}
  finally{await sql("drop trigger team_audit_failure on public.admin_audit_logs");}
  assert.equal((await mutate(request)).ok,true);
 });
 test("invalid/missing/expired sessions and owner loss while waiting for locks are rejected",async()=>{
  assert.equal((await read(owner,"platform_team_read_self","",{session_id:id(999)})).code,"UNAUTHENTICATED");
  await sql(`update private.app_session_activity set expired_at=clock_timestamp()where user_id='${owner}'`);assert.equal((await read(owner,"platform_team_read_self")).code,"UNAUTHENTICATED");await sql(`update private.app_session_activity set expired_at=null where user_id='${owner}'`);
  assert.equal((await read(unverified,"platform_team_read_self")).code,"UNVERIFIED");
  const request=await transferInput();const lock=session("begin;select pg_advisory_xact_lock(864210111);select 'LOCKED';",{keepOpen:true});
  while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  const pending=mutate(request);await waitBlocked(request.operation_id);await sql(`update public.platform_admins set status='disabled' where user_id='${owner}'`);
  lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"FORBIDDEN");assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);
 });
 test("concurrent transfers serialize; stale loser cannot overwrite the confirmed membership",async()=>{
  const c=id(103);assert.equal((await mutate(payload("create",{team_id:c,name:"Team C",manager_user_id:mb,expected_team_revision:0}))).ok,true);
  const one=await transferInput(),two={...one,operation_id:id(operation++),destination_team_id:c,expected_destination_revision:await revision(c),expected_destination_member_revision:0};
  const results=await Promise.all([mutate(one),mutate(two)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,"CONFLICT");
  const destination=results[0].ok?b:c;assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,destination);
  assert.equal(await sql(`select count(*)from public.platform_team_members where user_id='${ea}'and status='active'`),"1");
  assert.equal(await sql(`select count(*) from public.admin_audit_logs where action='platform.team.transfer'`),"1");
 });
 test("confirmed mutation and audit include the persisted team/member projection for read-failure recovery",async()=>{
  const result=await setMember(a,outsider);assert.ok(result.team,"confirmed result requires persisted team projection");assert.equal(result.team.id,a);assert.equal(result.team.manager_user_id,ma);assert.equal(result.member.user_id,outsider);assert.equal(result.member.status,"active");
  const audit=parse(await sql(`select after_data from public.admin_audit_logs where action='platform.team.set_member' and after_data->>'user_id'='${outsider}'`));assert.deepEqual(audit.team,result.team);assert.deepEqual(audit.member,result.member);assert.equal(audit.reason,"Synthetic owner change");
 });
 test("owner transfer/revoke race has one winner and cannot recreate a revoked current membership",async()=>{
  const move=await transferInput();const disable=payload("set_member",{team_id:a,user_id:ea,status:"disabled",expected_team_revision:move.expected_source_revision,expected_member_revision:move.expected_member_revision});
  const results=await Promise.all([mutate(move),mutate(disable)]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,"CONFLICT");
  const current=await read(ea,"platform_team_read_self");assert.ok(current.memberships.every(x=>x.access==="denied"||x.team.id===b));assert.equal(await sql(`select count(*) from public.platform_team_members where user_id='${ea}' and status='active'`),current.memberships.some(x=>x.access==="active")?"1":"0");
 });
 test("stored session deadline and expired JWT reject both reads and owner mutations",async()=>{
  const request=await transferInput();assert.equal((await read(owner,"platform_team_read_self","",{exp:1})).code,"UNAUTHENTICATED");
  await sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second'where user_id='${owner}'`);
  assert.equal((await mutate(request)).code,"UNAUTHENTICATED");assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);
 });
 test("lease expiry while waiting for hierarchy lock cannot mutate under the old statement clock",async()=>{
  const request=await transferInput();const lock=session("begin;select pg_advisory_xact_lock(864210111);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  await sql(`update private.app_session_activity set last_activity_at=clock_timestamp()-interval '2 hours'+interval '1 second'where user_id='${owner}'`);
  const pending=mutate(request);await waitBlocked(request.operation_id);await new Promise(r=>setTimeout(r,1500));lock.child.stdin.end("commit;\n");await lock.done;
  assert.equal((await pending).code,"UNAUTHENTICATED");assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);assert.equal(await sql(`select count(*)from private.platform_team_operations where operation_id='${request.operation_id}'`),"0");
 });
 test("session expiry/revocation behind a target-team lock leaves no mutation/audit/replay",async()=>{
  const request=await transferInput();const lock=session(`begin;select 1 from public.platform_teams where id='${a}'for update;select 'LOCKED';`,{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  const pending=mutate(request);await waitBlocked(request.operation_id);await sql(`update private.app_session_activity set expired_at=clock_timestamp()where user_id='${owner}'`);
  lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"UNAUTHENTICATED");assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);assert.equal(await sql(`select count(*)from private.platform_team_operations where operation_id='${request.operation_id}'`),"0");
 });
 test("authority lock contention returns unavailable without writes; exact request retries after recovery",async()=>{
  const request=await transferInput();const lock=session(`begin;select 1 from private.app_session_activity where user_id='${owner}'for update;select 'LOCKED';`,{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{
   assert.equal((await mutate(request)).code,"UNAVAILABLE");assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,a);
   assert.equal(await sql(`select count(*)from private.platform_team_operations where operation_id='${request.operation_id}'`),"0");
   assert.equal(await sql("select count(*)from public.admin_audit_logs where action='platform.team.transfer'"),"0");
  }finally{lock.child.stdin.end("commit;\n");await lock.done;}
  assert.equal((await mutate(request)).ok,true);assert.equal((await read(ea,"platform_team_read_self")).memberships.find(x=>x.access==="active").team.id,b);
 });
 test("one delegated admin may own multiple independent team scopes; platform disable revokes every roster",async()=>{
  const c=id(103);assert.equal((await mutate(payload("create",{team_id:c,name:"Team C",manager_user_id:ma,expected_team_revision:0}))).ok,true);
  assert.equal((await directory(ma)).total,2);assert.equal((await directory(ma,c)).total,1);
  await sql(`update public.platform_admins set status='disabled'where user_id='${ma}'`);
  assert.equal((await directory(ma,a)).code,"FORBIDDEN");assert.equal((await directory(ma,c)).code,"FORBIDDEN");
  assert.equal(await sql(`${auth(ma)}select count(*)from public.platform_team_members where user_id<>'${ma}'`).then(o=>o.split("\n").at(-1)),"0");
 });
 test("owner may only appoint a current delegated admin; membership alone and finance company scope grant no roster",async()=>{
  await sql(`insert into public.platform_admins(user_id,role,status)values('${unverified}','delegated','active')`);
  for(const candidate of[outsider,owner,unverified,id(999)])assert.equal((await mutate(payload("create",{team_id:id(103),name:"Team C",manager_user_id:candidate,expected_team_revision:0}))).code,"INVALID_MEMBER");
  await sql(`update public.platform_admins set status='disabled'where user_id='${mb}'`);
  assert.equal((await mutate(payload("update",{team_id:b,name:"Team B",status:"active",manager_user_id:mb,expected_team_revision:await revision(b)}))).code,"INVALID_MEMBER");
  assert.equal((await directory(mb,b)).code,"FORBIDDEN");assert.equal((await directory(finance,a)).code,"FORBIDDEN");
 });
 test("transfer and independent membership disable preserve unrelated active teams and company grants",async()=>{
  const c=id(103);assert.equal((await mutate(payload("create",{team_id:c,name:"Team C",manager_user_id:mb,expected_team_revision:0}))).ok,true);
  assert.equal((await setMember(c,ea)).ok,true);const unrelated=await sql(`select to_jsonb(m)from public.platform_team_members m where team_id='${c}'and user_id='${ea}'`);
  const grants=await sql("select jsonb_agg(to_jsonb(g))from public.company_member_grants g");
  assert.equal((await mutate(await transferInput())).ok,true);
  assert.equal(await sql(`select to_jsonb(m)from public.platform_team_members m where team_id='${c}'and user_id='${ea}'`),unrelated);
  assert.equal((await setMember(b,ea,"disabled")).ok,true);
  assert.equal(await sql(`select to_jsonb(m)from public.platform_team_members m where team_id='${c}'and user_id='${ea}'`),unrelated);
  assert.equal(await sql("select jsonb_agg(to_jsonb(g))from public.company_member_grants g"),grants);
  const self=await read(ea,"platform_team_read_self");assert.equal(self.memberships.filter(x=>x.access==="active").length,1);assert.equal(self.memberships.find(x=>x.access==="active").team.id,c);
 });
 test("plural self memberships expose only the caller and manager revocation is immediate",async()=>{
  assert.equal((await setMember(b,ea)).ok,true);const self=await read(ea,"platform_team_read_self");
  assert.deepEqual(self.memberships.map(x=>x.team.id),[a,b]);assert.ok(self.memberships.every(x=>x.membership.user_id===ea));
  await sql(`update public.platform_admins set role='owner'where user_id='${ma}'`);
  // A promoted owner keeps owner-wide authority; delegated roster authority is tested by disabling that row.
  await sql(`update public.platform_admins set status='disabled'where user_id='${ma}'`);
  assert.equal((await directory(ma,a)).code,"FORBIDDEN");
 });

 test("active destination conflicts and manager promotion cannot create employee reporting cycles",async()=>{
  assert.equal((await setMember(b,ea)).ok,true);const request=await transferInput();const before=await sql(`select jsonb_agg(to_jsonb(m)order by team_id)from public.platform_team_members m where user_id='${ea}'`);
  assert.equal((await mutate(request)).code,"CONFLICT");assert.equal(await sql(`select jsonb_agg(to_jsonb(m)order by team_id)from public.platform_team_members m where user_id='${ea}'`),before);
  await sql(`insert into public.platform_admins(user_id,role,status)values('${ea}','delegated','active')`);
  assert.equal((await mutate(payload("update",{team_id:a,name:"Team A",status:"active",manager_user_id:ea,expected_team_revision:await revision(a)}))).code,"INVALID_MEMBER");
  assert.equal((await setMember(b,ma)).code,"INVALID_MEMBER");
 });
 test("specialty persists across another client and revoked self status is available without roster access",async()=>{
  const request=payload("set_member",{team_id:a,user_id:ea,status:"active",specialty:"Finance",expected_team_revision:await revision(a),expected_member_revision:await memberRevision(a,ea)});
  assert.equal((await mutate(request)).ok,true);assert.equal((await directory(ma,a)).rows.find(x=>x.user_id===ea).specialty,"Finance");assert.equal((await directory(ma,a,null,25,"Finance")).total,1);
  const revoked=await setMember(a,ea,"disabled");assert.equal(revoked.ok,true);assert.equal((await directory(ea,a)).code,"FORBIDDEN");
  const self=await read(ea,"platform_team_read_self");assert.equal(self.memberships[0].membership.status,"disabled");assert.equal(self.memberships[0].membership.specialty,"Finance");assert.equal(self.memberships[0].access,"denied");assert.equal(self.memberships[0].team,null);
 });

 test("owner replacement atomically scopes an existing multi-team manager without employee enrollment",async()=>{
  const request=payload("update",{team_id:b,name:"Team B",status:"active",manager_user_id:ma,expected_team_revision:await revision(b)});
  assert.equal((await mutate(request)).ok,true);assert.equal((await directory(ma)).total,2);assert.equal((await directory(mb,b)).code,"FORBIDDEN");
  assert.equal(await sql(`select status from public.platform_team_members where team_id='${b}'and user_id='${ma}'`),"active");
 });
 test("preview rejects transfer of a manager retained in a disabled source before any mutation",async()=>{
  assert.equal((await mutate(payload("update",{team_id:a,name:"Team A",status:"disabled",manager_user_id:null,expected_team_revision:await revision(a)}))).ok,true);
  assert.equal((await mutate(payload("create",{team_id:id(103),name:"Team C",manager_user_id:ma,expected_team_revision:0}))).ok,true);
  const request=await transferInput(ma);assert.equal((await read(owner,"platform_team_preview_transfer",`${lit(JSON.stringify(request))}::jsonb`)).code,"INVALID_MEMBER");
  assert.equal((await mutate(request)).code,"INVALID_MEMBER");assert.equal(await sql(`select status from public.platform_team_members where team_id='${a}'and user_id='${ma}'`),"active");
 });
 test("pending manager roster cannot return a stale authorized response after platform revocation",async()=>{
  await sql(`create function private.test_pause_name(p_name text)returns text language plpgsql volatile as $$begin perform pg_advisory_xact_lock(864210112);return p_name;end;$$;alter table public.profiles rename to test_profiles_base;create view public.profiles as select user_id,private.test_pause_name(full_name)full_name,support_code from public.test_profiles_base;`);
  const lock=session("begin;select pg_advisory_xact_lock(864210112);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{
   const pending=directory(ma,a);await waitBlocked("platform_team_read_directory");await sql(`update public.platform_admins set status='disabled'where user_id='${ma}'`);
   lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"FORBIDDEN");
  }finally{if(!lock.child.stdin.destroyed)lock.child.stdin.end("commit;\n");await lock.done;await sql("drop view public.profiles;alter table public.test_profiles_base rename to profiles;drop function private.test_pause_name(text)");}
 });
 test("pending roster invalidates captured rows/count/cursor after membership revocation",async()=>{
  await sql(`create function private.test_pause_name(p_name text)returns text language plpgsql volatile as $$begin perform pg_advisory_xact_lock(864210112);return p_name;end;$$;alter table public.profiles rename to test_profiles_base;create view public.profiles as select user_id,private.test_pause_name(full_name)full_name,support_code from public.test_profiles_base;`);
  const lock=session("begin;select pg_advisory_xact_lock(864210112);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{const pending=directory(ma,a);await waitBlocked("platform_team_read_directory");assert.equal((await setMember(a,ea,"disabled")).ok,true);lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"CONFLICT");}
  finally{if(!lock.child.stdin.destroyed)lock.child.stdin.end("commit;\n");await lock.done;await sql("drop view public.profiles;alter table public.test_profiles_base rename to profiles;drop function private.test_pause_name(text)");}
 });
 test("pending self read cannot restore active membership after owner revocation",async()=>{
  await sql(`create function private.test_pause_name(p_name text)returns text language plpgsql volatile as $$begin perform pg_advisory_xact_lock(864210112);return p_name;end;$$;alter table public.profiles rename to test_profiles_base;create view public.profiles as select user_id,private.test_pause_name(full_name)full_name,support_code from public.test_profiles_base;`);
  const lock=session("begin;select pg_advisory_xact_lock(864210112);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{const pending=read(ea,"platform_team_read_self");await waitBlocked("platform_team_read_self");assert.equal((await setMember(a,ea,"disabled")).ok,true);lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"CONFLICT");assert.equal((await read(ea,"platform_team_read_self")).memberships[0].access,"denied");}
  finally{if(!lock.child.stdin.destroyed)lock.child.stdin.end("commit;\n");await lock.done;await sql("drop view public.profiles;alter table public.test_profiles_base rename to profiles;drop function private.test_pause_name(text)");}
 });
 test("pending employee self read cannot retain a revoked manager summary",async()=>{
  await sql(`create function private.test_pause_name(p_name text)returns text language plpgsql volatile as $$begin perform pg_advisory_xact_lock(864210112);return p_name;end;$$;alter table public.profiles rename to test_profiles_base;create view public.profiles as select user_id,private.test_pause_name(full_name)full_name,support_code from public.test_profiles_base;`);
  const lock=session("begin;select pg_advisory_xact_lock(864210112);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{const pending=read(ea,"platform_team_read_self");await waitBlocked("platform_team_read_self");await sql(`update public.platform_admins set status='disabled'where user_id='${ma}'`);lock.child.stdin.end("commit;\n");await lock.done;assert.equal((await pending).code,"FORBIDDEN");assert.equal((await read(ea,"platform_team_read_self")).memberships[0].manager,null);}
  finally{if(!lock.child.stdin.destroyed)lock.child.stdin.end("commit;\n");await lock.done;await sql("drop view public.profiles;alter table public.test_profiles_base rename to profiles;drop function private.test_pause_name(text)");}
 });
 test("reactivation rejects retained employee edges for an admin managing another active team",async()=>{
  assert.equal((await mutate(payload("update",{team_id:a,name:"Team A",status:"disabled",manager_user_id:null,expected_team_revision:await revision(a)}))).ok,true);
  assert.equal((await mutate(payload("create",{team_id:id(103),name:"Team C",manager_user_id:ma,expected_team_revision:0}))).ok,true);
  const request=payload("update",{team_id:a,name:"Team A",status:"active",manager_user_id:mb,expected_team_revision:await revision(a)});
  assert.equal((await mutate(request)).code,"INVALID_MEMBER");assert.equal(await sql(`select status from public.platform_teams where id='${a}'`),"disabled");
 });
 test("roster cursor cannot be reused across two authorized teams sharing the same member revision",async()=>{
  assert.equal((await setMember(a,outsider)).ok,true);assert.equal((await setMember(b,ea)).ok,true);
  const page=await directory(owner,a,null,2);assert.equal(page.next_cursor.id,ea);assert.equal(page.next_cursor.revision,await memberRevision(b,ea));
  const reused=await directory(owner,b,page.next_cursor,2);assert.equal(reused.code,"INVALID_INPUT");
 });
 test("between-page roster revocation invalidates navigation without relying on the cursor row changing",async()=>{
  const page=await directory(ma,a,null,1);assert.equal(page.next_cursor.id,ma);const unchanged=await memberRevision(a,ma);
  assert.equal((await setMember(a,ea,"disabled")).ok,true);assert.equal(await memberRevision(a,ma),unchanged);
  assert.equal((await directory(ma,a,page.next_cursor,1)).code,"CONFLICT");
 });
 test("team-list cursor binds actor/search and the entire currently authorized scope",async()=>{
  const page=await directory(owner,null,null,1);assert.equal(page.next_cursor.id,a);
  assert.equal((await directory(ma,null,page.next_cursor,1)).code,"INVALID_INPUT");
  assert.equal((await directory(owner,null,page.next_cursor,1,"Team")).code,"INVALID_INPUT");
  assert.equal((await mutate(payload("update",{team_id:b,name:"Team B revised",status:"active",manager_user_id:mb,expected_team_revision:await revision(b)}))).ok,true);
  assert.equal((await directory(owner,null,page.next_cursor,1)).code,"CONFLICT");
 });
 for(const [name,change,expectedCode]of[
  ["owner role",`update public.platform_admins set status='disabled'where user_id='${owner}'`,"FORBIDDEN"],
  ["destination manager role",`update public.platform_admins set status='disabled'where user_id='${mb}'`,"INVALID_MEMBER"],
  ["source team revision",`update public.platform_teams set revision=revision+1 where id='${a}'`,"CONFLICT"],
  ["destination team revision",`update public.platform_teams set revision=revision+1 where id='${b}'`,"CONFLICT"],
  ["source membership revision",`update public.platform_team_members set revision=revision+1 where team_id='${a}'and user_id='${ea}'`,"CONFLICT"],
  ["absent destination membership",`insert into public.platform_team_members(team_id,user_id,status)values('${b}','${ea}','disabled')`,"CONFLICT"]
 ])test("pending transfer preview rechecks "+name+" before returning protected projections",async()=>{
  const request=await transferInput();const audits=await sql("select count(*)from public.admin_audit_logs"),operations=await sql("select count(*)from private.platform_team_operations");
  await sql(`alter function private.platform_team_transfer_preview(jsonb)rename to test_transfer_preview_base;create function private.platform_team_transfer_preview(p_input jsonb)returns jsonb language plpgsql stable security definer set search_path=''as $$declare result jsonb;begin result:=private.test_transfer_preview_base(p_input);perform pg_advisory_xact_lock(864210113);return result;end;$$;`);
  const lock=session("begin;select pg_advisory_xact_lock(864210113);select 'LOCKED';",{keepOpen:true});while(!lock.output().includes("LOCKED"))await new Promise(r=>setTimeout(r,20));
  try{const pending=read(owner,"platform_team_preview_transfer",`${lit(JSON.stringify(request))}::jsonb`);await waitBlocked("platform_team_preview_transfer");await sql(change);lock.child.stdin.end("commit;\n");await lock.done;const result=await pending;assert.equal(result.code,expectedCode);assert.equal("source_team"in result,false);assert.equal(await sql("select count(*)from public.admin_audit_logs"),audits);assert.equal(await sql("select count(*)from private.platform_team_operations"),operations);}
  finally{if(!lock.child.stdin.destroyed)lock.child.stdin.end("commit;\n");await lock.done;await sql("drop function private.platform_team_transfer_preview(jsonb);alter function private.test_transfer_preview_base(jsonb)rename to platform_team_transfer_preview");}
 });
 test("installer rejects exact production dependency body drift before changing existing team state",async()=>{
  const before=await sql("select jsonb_agg(to_jsonb(t)order by id)from public.platform_teams t");
  const canonical=await import("node:fs").then(fs=>fs.readFileSync("supabase/migrations/20261007230212_vel_platform_owner_identity.sql","utf8"));
  const start=canonical.indexOf("create or replace function public.is_platform_owner("),end=canonical.indexOf("$$;",start)+3;
  await sql(canonical.slice(start,end));
  try{await assert.rejects(()=>file("supabase/upgrade-packages/platform-teams/10-teams.review.sql"),/TEAM_DEPENDENCY_BODY_MISMATCH/);assert.equal(await sql("select jsonb_agg(to_jsonb(t)order by id)from public.platform_teams t"),before);}
  finally{await sql("set velora.fixture_dependencies='synthetic-local';"+await import("node:fs").then(fs=>fs.readFileSync("scripts/platform-teams/production-dependencies.review.sql","utf8")));}
 });
 test("transfer preview remains valid in a read-only transaction and creates no audit or replay outcome",async()=>{
  const request=await transferInput();const before=await sql("select jsonb_build_array((select count(*)from public.admin_audit_logs),(select count(*)from private.platform_team_operations))");
  const result=parse(await sql(`begin read only;${auth(owner)}select public.platform_team_preview_transfer(${lit(JSON.stringify(request))}::jsonb);commit;`));assert.equal(result.ok,true);
  assert.equal(await sql("select jsonb_build_array((select count(*)from public.admin_audit_logs),(select count(*)from private.platform_team_operations))"),before);
 });
}
