import {beforeAll,afterAll,expect,it} from 'vitest';
// @ts-expect-error local disposable PostgreSQL helper
import {isolatedPostgres} from '../../../scripts/account-deletion/postgres.mjs';
// @ts-expect-error shared production-shaped baseline fixture
import {installProductionTeamBaseline,installTeamMigration} from '../../../scripts/live-customer/team-production-compat.test.mjs';
let db:{sql:(s:string)=>Promise<string>;close:()=>Promise<void>};
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cid=id(2),bid=id(3),other=id(4),owner=id(1),staff=id(30);
const token=(op:number)=>op.toString(16).padStart(64,'0');
const invoke=(email:string,op:number,branch=bid,user=owner)=>`set role authenticated;set request.uid='${user}';select public.es02_invite_owned_branch_team('${user}','${cid}','${branch}',1,'${id(op)}','Staff','${email}',array['wa.conversations.read'],'${token(op)}');`;
const accept=(user=staff,op=10)=>`set role authenticated;set request.uid='${user}';select public.accept_staff_invitation('${token(op)}');`;
const capability=(branch=bid,cap='wa.conversations.read',user=staff)=>`set role authenticated;set request.uid='${user}';select public.es02_has_branch_capability('${cid}','${branch}','${cap}');`;
beforeAll(async()=>{
 db=await isolatedPostgres();await installProductionTeamBaseline(db);
 await db.sql(`insert into auth.users values('${owner}','owner@example.test',now()),('${staff}','one@example.test',now()),('${id(31)}','legacy@example.test',now()),('${id(90)}','stranger@example.test',now());
 insert into public.companies(id,display_name,created_by) values('${cid}','Local fixture','${owner}');
 insert into public.company_members(company_id,user_id,role) values('${cid}','${owner}','owner');
 insert into public.company_branches values('${bid}','${cid}','Main','setup',true),('${other}','${cid}','Other','active',false);
 insert into private.es02_branch_slot_rights values('${cid}','${bid}',2),('${cid}','${other}',2);`);
 await installTeamMigration(db);
},120000);
afterAll(async()=>{await db?.close();},30000);
it('owner survives, unauthorized callers and branches are rejected, operation replay is exact',async()=>{
 expect(await db.sql(`select role||':'||status||':'||es02_branch_only from public.company_members where user_id='${owner}'`)).toBe('owner:active:false');
 expect(await db.sql(capability(other,'wa.conversations.read',owner))).toBe('t');
 expect(JSON.parse(await db.sql(invoke('one@example.test',10))).ok).toBe(true);
 expect(JSON.parse(await db.sql(invoke('one@example.test',10))).replayed).toBe(true);
 expect(JSON.parse(await db.sql(invoke('changed@example.test',10))).code).toBe('OPERATION_CONFLICT');
 expect(JSON.parse(await db.sql(invoke('bad@example.test',11,id(99)))).ok).toBe(false);
 expect(JSON.parse(await db.sql(invoke('bad@example.test',12,bid,id(90)))).ok).toBe(false);
 expect(await db.sql(`select capabilities[1]||':'||branch_id::text from private.es02_team_invitation_scope`)).toBe(`wa.conversations.read:${bid}`);
},30000);
it('acceptance is idempotent and confers only explicit branch authority without legacy active membership',async()=>{
 expect(JSON.parse(await db.sql(accept(id(90)))).code).toBe('EMAIL_MISMATCH');
 const accepted=await Promise.all([db.sql(accept()),db.sql(accept())]);
 expect(accepted.map(r=>JSON.parse(r).ok)).toEqual([true,true]);
 expect(JSON.parse(await db.sql(accept())).ok).toBe(true);
 expect(await db.sql(`select count(*) from private.es02_team_recipients('${cid}','${bid}')`)).toBe('1');
 expect(await db.sql(`select status||':'||es02_branch_only from company_members where user_id='${staff}'`)).toBe('branch_active:true');
 expect(await db.sql(`select count(*) from company_members where user_id='${staff}' and status='active'`)).toBe('0');
 expect(await db.sql(`select count(*) from company_member_grants where user_id='${staff}'`)).toBe('0');
 expect(await db.sql(capability())).toBe('t');
 expect(await db.sql(capability(other))).toBe('f');
 expect(await db.sql(capability(bid,'ig.conversations.read'))).toBe('f');
 expect(await db.sql(`set request.session_valid='false';${capability()}`)).toBe('f');
 await expect(db.sql(`update company_members set status='active' where user_id='${staff}'`)).rejects.toThrow('es02_branch_member_scope');
 await expect(db.sql(`update company_members set es02_branch_only=false,status='active' where user_id='${staff}'`)).rejects.toThrow('MEMBER_SCOPE_IMMUTABLE');
},30000);
it('two real concurrent transactions competing for the final seat produce exactly one pending invitation',async()=>{
 const results=await Promise.all([db.sql(invoke('two@example.test',20)),db.sql(invoke('three@example.test',21))]);
 const parsed=results.map(r=>JSON.parse(r));
 expect(parsed.filter(r=>r.ok)).toHaveLength(1);expect(parsed.filter(r=>r.code==='TEAM_SEATS_FULL')).toHaveLength(1);
 expect(await db.sql(`select count(*) from private.es02_team_recipients('${cid}','${bid}')`)).toBe('2');
 expect(await db.sql(`select count(*) from private.staff_invitations where accepted_at is null and cancelled_at is null`)).toBe('1');
 expect(JSON.parse(await db.sql(invoke('four@example.test',22))).code).toBe('TEAM_SEATS_FULL');
},30000);
it('owner can add and revoke another branch explicitly; unauthorized changes and stale revisions fail',async()=>{
 const change=(user:string,revoke:boolean,revision:number)=>`set role authenticated;set request.uid='${user}';select public.es02_set_owned_branch_member('${user}','${cid}','${other}','${staff}',array['ig.conversations.read'],${revoke},${revision});`;
 expect(JSON.parse(await db.sql(change(staff,false,0))).ok).toBe(false);
 expect(JSON.parse(await db.sql(change(owner,false,0))).ok).toBe(true);
 expect(await db.sql(capability(other,'ig.conversations.read'))).toBe('t');
 expect(await db.sql(capability(other))).toBe('f');
 expect(JSON.parse(await db.sql(change(owner,true,0))).code).toBe('STALE_REVISION');
 expect(JSON.parse(await db.sql(change(owner,true,1))).ok).toBe(true);
 expect(await db.sql(capability(other,'ig.conversations.read'))).toBe('f');
 expect(await db.sql(capability())).toBe('t');
},30000);
it('branch inbox binds verified generation to its provider account and rejects other branches and conversations',async()=>{
 // Synthetic local channel records exercise the real SQL filters; projection and
 // billing boundaries are minimal stand-ins, not provider acceptance evidence.
 await db.sql(`create function private.billing_chat_access(uuid,text) returns boolean language sql as $$select coalesce(current_setting('request.billing_allowed',true),'true')<>'false'$$;
 create function private.billing_history_account_allowed(uuid,text,text) returns boolean language sql as $$select coalesce(current_setting('request.history_allowed',true),'true')<>'false'$$;
 create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,channel text,legacy_link_id uuid,legacy_generation integer,verified boolean,status text,revoked_at timestamptz);
 create table public.whatsapp_company_links(id uuid,company_id uuid,generation integer,provider_phone_number_id text,status text,authorization_status text,authorization_expires_at timestamptz);
 create table public.whatsapp_conversations(id uuid,company_id uuid,phone_number_id text,inbox_sequence bigint);
 create table public.whatsapp_messages(id uuid,company_id uuid,conversation_id uuid,arrival_sequence bigint);
 create function private.whatsapp_inbox_conversation_public(public.whatsapp_conversations,uuid) returns jsonb language sql as $$select jsonb_build_object('id',($1).id)$$;
 create function private.whatsapp_inbox_message_public(public.whatsapp_messages) returns jsonb language sql as $$select jsonb_build_object('id',($1).id)$$;
 -- Minimal legacy policy double: real RLS requires active company capability,
 -- together with billing/history gates; branch_active is intentionally excluded.
 alter table public.whatsapp_conversations enable row level security;
 alter table public.whatsapp_messages enable row level security;
 grant select on public.whatsapp_conversations,public.whatsapp_messages to authenticated;
 grant usage on schema private to authenticated;
 grant execute on function private.billing_chat_access(uuid,text),private.billing_history_account_allowed(uuid,text,text) to authenticated;
 create policy legacy_conversation_read on public.whatsapp_conversations to authenticated using(public.has_company_capability(company_id,'wa.conversations.read') and private.billing_chat_access(company_id,'whatsapp') and private.billing_history_account_allowed(company_id,'whatsapp',phone_number_id));
 create policy legacy_message_read on public.whatsapp_messages to authenticated using(exists(select 1 from public.whatsapp_conversations c where c.id=conversation_id and c.company_id=whatsapp_messages.company_id));
 insert into private.es02_b3_connection_links values('${cid}','${bid}','whatsapp','${id(60)}',1,true,'active',null);
 insert into public.whatsapp_company_links values('${id(60)}','${cid}',1,'local-phone','verified','active',null);
 insert into public.whatsapp_conversations values('${id(61)}','${cid}','local-phone',1),('${id(62)}','${cid}','other-phone',2);
 insert into public.whatsapp_messages values('${id(63)}','${cid}','${id(61)}',1);`);
 const inbox=(branch=bid,conversation:string|null=null)=>`set role authenticated;set request.uid='${staff}';select public.es02_read_branch_inbox('${cid}','${branch}','whatsapp',${conversation?`'${conversation}'`:'null'});`;
 const list=JSON.parse(await db.sql(inbox()));expect(list.ok).toBe(true);expect(list.conversations).toEqual([{id:id(61)}]);
 expect(JSON.parse(await db.sql(inbox(bid,id(61)))).messages).toEqual([{id:id(63)}]);
 expect(JSON.parse(await db.sql(inbox(bid,id(62)))).code).toBe('NOT_FOUND');
 expect(JSON.parse(await db.sql(inbox(other))).code).toBe('FORBIDDEN');
 expect(JSON.parse(await db.sql(inbox().replace('whatsapp','instagram'))).code).toBe('FORBIDDEN');
 expect(JSON.parse(await db.sql(`set request.billing_allowed='false';${inbox()}`)).code).toBe('FORBIDDEN');
 expect(JSON.parse(await db.sql(`set request.history_allowed='false';${inbox()}`)).code).toBe('FORBIDDEN');
 expect(await db.sql(`set role authenticated;set request.uid='${staff}';select count(*) from public.whatsapp_conversations`)).toBe('0');
 expect(await db.sql(`set role authenticated;set request.uid='${staff}';select count(*) from public.whatsapp_messages`)).toBe('0');
 expect(await db.sql(`set role authenticated;set request.uid='${owner}';select count(*) from public.whatsapp_conversations`)).toBe('2');
 await db.sql('update private.es02_b3_connection_links set revoked_at=now()');
 expect(JSON.parse(await db.sql(inbox())).code).toBe('FORBIDDEN');
 await db.sql('update private.es02_b3_connection_links set revoked_at=null');
 const access=JSON.parse(await db.sql(`set role authenticated;set request.uid='${staff}';select public.es02_list_my_branch_access();`));expect(access.branches.map((b:{branchId:string})=>b.branchId)).toEqual([bid]);
 await db.sql('update public.whatsapp_company_links set generation=2');
 expect(JSON.parse(await db.sql(inbox())).code).toBe('FORBIDDEN');
},30000);
it('owner revoke RPC cancels pending seats and removes accepted branch authority with revision checks',async()=>{
 const pending=JSON.parse(await db.sql(`select private.staff_invitation_projection(id) from private.staff_invitations where accepted_at is null and cancelled_at is null`));
 const revoke=(invitation:string,revision:number,branch=bid,user=owner)=>`set role authenticated;set request.uid='${user}';select public.es02_revoke_owned_branch_team('${user}','${cid}','${branch}','${invitation}',${revision});`;
 expect(JSON.parse(await db.sql(revoke(pending.id,pending.revision,other))).code).toBe('FORBIDDEN');
 expect(JSON.parse(await db.sql(revoke(pending.id,pending.revision,bid,staff))).ok).toBe(false);
 expect(JSON.parse(await db.sql(revoke(pending.id,pending.revision))).ok).toBe(true);
 expect(await db.sql(`select count(*) from private.es02_team_recipients('${cid}','${bid}')`)).toBe('1');
 const accepted=await db.sql(`select id from private.staff_invitations where token_hash='${token(10)}'`);
 expect(JSON.parse(await db.sql(revoke(accepted,99))).code).toBe('STALE_REVISION');
 expect(JSON.parse(await db.sql(revoke(accepted,1))).ok).toBe(true);
 expect(await db.sql(capability())).toBe('f');
 expect(JSON.parse(await db.sql(accept())).ok).toBe(false);
 expect(await db.sql(`select count(*) from private.es02_team_recipients('${cid}','${bid}')`)).toBe('0');
},30000);


it('legacy company invitations retain deployed acceptance while private branch data and helpers stay closed',async()=>{
 const created=JSON.parse(await db.sql(`set role authenticated;set request.uid='${owner}';select public.mutate_staff_invitation('${cid}','${id(50)}','create','legacy@example.test','Legacy',null,null,'${token(50)}');`));
 expect(created.ok).toBe(true);expect(JSON.parse(await db.sql(accept(id(31),50))).ok).toBe(true);
 expect(await db.sql(`select status||':'||es02_branch_only from company_members where user_id='${id(31)}'`)).toBe('active:false');
 await expect(db.sql('set role authenticated;select * from private.es02_branch_member_grants')).rejects.toThrow('permission denied');
 expect(await db.sql(`select has_function_privilege('authenticated','private.es02_team_reserve(uuid,uuid,text)','execute')`)).toBe('f');
 expect(await db.sql(`select has_function_privilege('authenticated','private.es02_accept_company_staff_invitation(text)','execute')`)).toBe('f');
});


it('native company invitations cannot bypass paid seats and grandfathered acceptance preserves its reserved seat',async()=>{
 // Independent company: this test can be run alone after a trigger-only change.
 const company=id(70),branch=id(71),legacyOwner=id(90);
 await db.sql(`insert into public.companies(id,display_name,created_by) values('${company}','Legacy local fixture','${legacyOwner}');
 insert into public.company_members(company_id,user_id,role) values('${company}','${legacyOwner}','owner');
 insert into public.company_branches values('${branch}','${company}','Legacy','active',true);
 insert into private.es02_branch_slot_rights values('${company}','${branch}',4);
 insert into auth.users values('${id(72)}','grandfather@example.test',now());`);
 for(let n=0;n<4;n++) {
  const email=n===0?'grandfather@example.test':`legacy-seat-${n}@example.test`;
  expect(JSON.parse(await db.sql(`set role authenticated;set request.uid='${legacyOwner}';select public.mutate_staff_invitation('${company}','${id(80+n)}','create','${email}','Legacy',null,null,'${token(80+n)}');`)).ok).toBe(true);
 }
 await expect(db.sql(`set role authenticated;set request.uid='${legacyOwner}';select public.mutate_staff_invitation('${company}','${id(84)}','create','overflow@example.test','Overflow',null,null,'${token(84)}');`)).rejects.toThrow('TEAM_SEATS_FULL');
 await db.sql(`update private.es02_branch_slot_rights set employees=2 where branch_id='${branch}'`);
 await expect(db.sql(`update public.company_members set role='staff' where company_id='${company}' and user_id='${legacyOwner}'`)).rejects.toThrow('TEAM_SEATS_FULL');
 expect(await db.sql(`select role from public.company_members where company_id='${company}' and user_id='${legacyOwner}'`)).toBe('owner');
 expect(JSON.parse(await db.sql(accept(id(72),80))).ok).toBe(true);
 expect(await db.sql(`select count(*) from private.es02_team_recipients('${company}','${branch}')`)).toBe('4');
 await db.sql(`insert into public.company_member_grants(company_id,user_id,capabilities,conversation_scope) values('${company}','${id(72)}',array['wa.conversations.read'],'assigned_only')`);
 expect(JSON.parse(await db.sql(`set role authenticated;set request.uid='${id(72)}';select public.es02_read_branch_inbox('${company}','${branch}','whatsapp');`)).code).toBe('FORBIDDEN');
},30000);
