import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error Guarded networkless disposable PostgreSQL fixture, not a cloud client.
import {bootstrap,cleanup,file,sql,lit,session} from '../../../scripts/instagram-connection/postgres.mjs';
const id=(n:number)=>`f2000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=(n=1)=>`set role authenticated;set request.jwt.claims=${lit(JSON.stringify({sub:id(n),session_id:id(n+100),role:'authenticated'}))};`;
const call=async(name:string,args:string,n=1)=>JSON.parse(await sql(actor(n)+`select public.${name}(${args});`));
type Held={child:{stdin:{end:(s:string)=>void}};done:Promise<unknown>;output:()=>string};const held=new Set<Held>();const hold=(q:string)=>{const h=session(q,{keepOpen:true}) as Held;held.add(h);return h;};afterEach(async()=>{for(const h of held){h.child.stdin.end('rollback;\n');await h.done.catch(()=>{});}held.clear();});
beforeAll(async()=>{
 await bootstrap('supabase/migrations/20261013225246_vel_setup_drafts.sql');
 await sql(`alter table auth.users add column deleted_at timestamptz,add column banned_until timestamptz;
 alter table public.companies add column version bigint default 1,add column country text default 'OM',add column setup_file_destruction_at timestamptz,add column created_by uuid,add column city text default '',add column business_type text default 'other',add column reply_language text default 'both',add column hours text default '',add column contact_phone text default '',add column contact_email text default '';
 create function public.is_platform_admin() returns boolean language sql as $$select false$$;
 create function private.user_has_company_capability(p_user_id uuid,p_company_id uuid,p_capability text) returns boolean language sql security definer as $$select exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_user_id and status='active' and role='owner') or exists(select 1 from public.company_member_grants where company_id=p_company_id and user_id=p_user_id and status='active' and p_capability=any(capabilities))$$;
 create function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql security definer as $$select private.user_has_company_capability(auth.uid(),p_company_id,p_capability)$$;
 create function private.master_activation_can_operate(cid uuid) returns boolean language sql as $$select true$$;
 create function private.channel_operation_allowed(cid uuid,ch text,op text) returns boolean language sql as $$select true$$;
 create table private.company_selected_channels(company_id uuid,channels text[]);
 create function private.master_activation_channel_gate(cid uuid,ch text,op text) returns boolean language sql as $$select true$$;
 create function private.master_activation_human_deadline(cid uuid,ch text,rid uuid) returns timestamptz language sql as $$select clock_timestamp()+interval '1 day'$$;
 create table public.fixture_finance(company_id uuid references public.companies on delete restrict,paid_through timestamptz,amount integer);
 create table public.knowledge_sources(id uuid primary key default gen_random_uuid(),company_id uuid,kind text,title text,content text,status text,created_by uuid,created_at timestamptz default clock_timestamp(),updated_at timestamptz default clock_timestamp(),content_version integer default 1,approved_for_answers boolean default false);
 alter table public.knowledge_sources enable row level security;grant select,insert,update,delete on public.knowledge_sources to authenticated;create policy fixture_native_knowledge on public.knowledge_sources for all to authenticated using(public.has_company_capability(company_id,'knowledge.write')) with check(public.has_company_capability(company_id,'knowledge.write'));create policy fixture_native_read on public.knowledge_sources for select to authenticated using(public.has_company_capability(company_id,'knowledge.read'));
 create table private.fixture_old_capability_oid as select 'public.has_company_capability(uuid,text)'::regprocedure::oid id;
 create schema storage;create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;create policy fixture_native_storage on storage.objects for all to authenticated using(true) with check(true);
 create function private.fixture_company_version() returns trigger language plpgsql as $$begin new.version:=old.version+1;return new;end$$;create trigger fixture_company_version before update on public.companies for each row execute function private.fixture_company_version();
 drop index public.company_members_one_active_owner_per_user;
 insert into auth.users(id,email,email_confirmed_at) values('${id(1)}','owner@test.invalid',clock_timestamp()),('${id(2)}','staff@test.invalid',clock_timestamp());insert into auth.sessions(id,user_id) values('${id(101)}','${id(1)}'),('${id(102)}','${id(2)}');`);
 const s=readFileSync('supabase/migrations/20261014015933_master_setup_draft_lifecycle.sql','utf8');const at=s.indexOf('create function private.master_setup_draft_session(');await sql(s.slice(at,s.indexOf('$$;',at)+3));
 await file('supabase/migrations/20261014033010_master_knowledge_import.sql');await file('supabase/migrations/20261014033011_master_business_archive.sql');
},30000);
afterAll(cleanup);
beforeEach(async()=>{await sql(`truncate private.master_knowledge_import_previews,private.master_business_lifecycle_audit,private.master_business_deletion_requests,public.knowledge_sources,public.fixture_finance,storage.objects,public.company_member_grants,public.company_members,public.companies cascade;update private.master_knowledge_import_settings set enabled=true;update private.master_business_archive_settings set enabled=true;
 update auth.users set banned_until=null,deleted_at=null;insert into public.companies(id,display_name,status,created_by) values('${id(201)}','Owner shop','active','${id(1)}'),('${id(202)}','Other shop','active','${id(1)}');insert into public.company_members(company_id,user_id,role) values('${id(201)}','${id(1)}','owner'),('${id(202)}','${id(1)}','owner'),('${id(201)}','${id(2)}','staff');insert into public.fixture_finance values('${id(201)}',clock_timestamp()+interval '1 day',45000);`);});
const stage=(n=1)=>call('master_stage_knowledge_import',`'${id(n)}','${id(201)}','${id(301)}','https://public.example/services','Our installation services',true,1` ,n);
it('default off, wrong actor, and staff without explicit write cannot stage',async()=>{
 expect(await stage(2)).toMatchObject({ok:false,code:'FORBIDDEN'});await sql('update private.master_knowledge_import_settings set enabled=false');expect(await stage()).toMatchObject({ok:false,code:'UNCONFIGURED'});
});
it('confirmation creates a new unapproved source exactly once and detects native catalog changes',async()=>{
 const p=await stage();expect(p.data.confidence).toBe('unverified');const args=`'${id(1)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`;
 const confirmed=await call('master_confirm_knowledge_import',args);expect(confirmed.ok).toBe(true);expect(await call('master_confirm_knowledge_import',args)).toEqual(confirmed);expect(await sql('select approved_for_answers::text from public.knowledge_sources')).toBe('false');
 await sql(`delete from private.master_knowledge_import_previews;`);const newer=await stage();await sql(`update public.knowledge_sources set content_version=content_version+1;`);expect(await call('master_confirm_knowledge_import',`'${id(1)}','${id(201)}','${newer.data.id}',1,'${newer.data.contentHash}'`)).toMatchObject({ok:false,code:'CONFLICT'});
});
it('preview is bound to native session, actor, company and company version',async()=>{
 const p=await stage();await sql(`insert into auth.sessions(id,user_id) values('${id(103)}','${id(1)}');`);const args=`'${id(1)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`;
 expect(JSON.parse(await sql(actor().replace(id(101),id(103))+`select public.master_confirm_knowledge_import(${args});`))).toMatchObject({ok:false,code:'FORBIDDEN'});
 await sql(`update public.companies set city='Changed' where id='${id(201)}'`);expect(await call('master_confirm_knowledge_import',args)).toMatchObject({ok:false,code:'CONFLICT'});
});
it('archive preserves original finance/status and fences native operations while read support remains',async()=>{
 const original=await sql('select paid_through from public.fixture_finance');const archived=await call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`);expect(archived.ok).toBe(true);
 expect(await sql('select paid_through from public.fixture_finance')).toBe(original);expect(await sql(`select status from public.companies where id='${id(201)}'`)).toBe('active');
 expect(await sql(actor()+`select public.has_company_capability('${id(201)}','knowledge.write')`)).toBe('f');expect(await sql(actor()+`select public.has_company_capability('${id(201)}','knowledge.read')`)).toBe('t');expect(await sql(`select private.master_activation_channel_gate('${id(201)}','instagram','send')`)).toBe('f');expect(await sql(`select private.master_activation_channel_gate('${id(201)}','instagram','read')`)).toBe('t');
 expect(await call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`)).toEqual(archived);expect(await call('master_set_business_archive',`'${id(1)}','${id(201)}',${archived.data.version},false`)).toMatchObject({ok:true});
});
it('staff cannot archive; CAS and destruction tombstone cannot be restored',async()=>{
 expect(await call('master_set_business_archive',`'${id(2)}','${id(201)}',1,true`,2)).toMatchObject({ok:false,code:'FORBIDDEN'});expect(await call('master_set_business_archive',`'${id(1)}','${id(201)}',99,true`)).toMatchObject({ok:false,code:'CONFLICT'});
 const r=await call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`);await sql(`update public.companies set setup_file_destruction_at=clock_timestamp() where id='${id(201)}'`);expect(await call('master_set_business_archive',`'${id(1)}','${id(201)}',${r.data.version+1},false`)).toMatchObject({ok:false,code:'NEW_BUSINESS_REQUIRED'});
});
it('delete request is audited and idempotent with unconfigured purpose/legality; never deletes identity or finance',async()=>{
 const args=`'${id(1)}','${id(201)}',1,'${id(401)}','Owner requests permanent removal'`;const r=await call('master_request_business_deletion',args);expect(r).toMatchObject({ok:true,data:{state:'awaiting_stepup_policy',legalPolicy:'UNCONFIGURED'}});expect(await call('master_request_business_deletion',args)).toEqual(r);expect(await sql('select count(*) from public.fixture_finance')).toBe('1');expect(await sql('select count(*) from auth.users')).toBe('2');expect(await sql('select count(*) from private.master_business_lifecycle_audit')).toBe('1');
});
it('retained banned/deleted native actor cannot import/archive/read or request deletion',async()=>{
 for(const column of ['banned_until','deleted_at']){await sql(`update auth.users set ${column}=clock_timestamp()+interval '1 day' where id='${id(1)}'`);expect(await stage()).toMatchObject({ok:false,code:'UNAUTHENTICATED'});expect(await call('master_list_owned_businesses',`'${id(1)}'`)).toMatchObject({ok:false,code:'UNAUTHENTICATED'});expect(await call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`)).toMatchObject({ok:false,code:'UNAUTHENTICATED'});await sql(`update auth.users set ${column}=null`);}
});
it('explicit staff knowledge.write is sufficient, revocation denies confirmation, and mismatched company cannot read preview',async()=>{
 await sql(`insert into public.company_member_grants(company_id,user_id,capabilities,status) values('${id(201)}','${id(2)}',array['knowledge.write'],'active')`);const p=await stage(2);expect(p.ok).toBe(true);expect(await call('master_read_knowledge_import',`'${id(2)}','${id(202)}','${p.data.id}'`,2)).toMatchObject({ok:false,code:'FORBIDDEN'});await sql('update public.company_member_grants set status=\'disabled\'');expect(await call('master_confirm_knowledge_import',`'${id(2)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`,2)).toMatchObject({ok:false,code:'FORBIDDEN'});
});
it('an in-flight grant revocation wins before a staff import confirmation commits',async()=>{
 await sql(`insert into public.company_member_grants(company_id,user_id,capabilities,status) values('${id(201)}','${id(2)}',array['knowledge.write'],'active')`);
 const p=await stage(2);expect(p.ok).toBe(true);
 // The native access_set_member_grants authority locks this exact grant row.
 // Hold its revocation uncommitted so an unlocked permission read sees the old grant.
 const h=hold(`begin;update public.company_member_grants set status='disabled' where company_id='${id(201)}' and user_id='${id(2)}';select 'grant-revocation-held';`);
 for(let i=0;i<30&&!h.output().includes('grant-revocation-held');i++)await sql('select 1');expect(h.output()).toContain('grant-revocation-held');
 let finished=false;const waiting=call('master_confirm_knowledge_import',`'${id(2)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`,2).then(r=>{finished=true;return r;});
 for(let i=0;i<30&&!finished;i++){if(Number(await sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'"))>0)break;}
 h.child.stdin.end('commit;\n');await h.done;held.delete(h);
 expect(await waiting).toMatchObject({ok:false,code:'FORBIDDEN'});expect(await sql('select count(*) from public.knowledge_sources')).toBe('0');
},20000);
it('a native actor ban during a preview lock wait denies confirmation after the wait',async()=>{
 const p=await stage();const h=hold(`begin;select id from private.master_knowledge_import_previews where id='${p.data.id}' for update;select 'preview-held';`);
 for(let i=0;i<30&&!h.output().includes('preview-held');i++)await sql('select 1');expect(h.output()).toContain('preview-held');
 const waiting=call('master_confirm_knowledge_import',`'${id(1)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`);
 let blocked=false;for(let i=0;i<30;i++){if(Number(await sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'"))>0){blocked=true;break;}}expect(blocked).toBe(true);
 await sql(`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${id(1)}'`);h.child.stdin.end('commit;\n');await h.done;held.delete(h);
 expect(await waiting).toMatchObject({ok:false,code:'UNAUTHENTICATED'});expect(await sql('select count(*) from public.knowledge_sources')).toBe('0');
},20000);
it('archive fences old unscoped storage and existing RLS OID, but keeps its content readable and other businesses usable',async()=>{
 await sql(`insert into storage.objects values('company-knowledge','${id(201)}/${id(601)}/legacy.pdf'),('company-knowledge','${id(202)}/${id(602)}/other.pdf');insert into public.knowledge_sources(company_id,kind,title,content,status,created_by) values('${id(201)}','text','History','Facts remain','ready','${id(1)}')`);await call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`);
 expect(await sql("select id='public.has_company_capability(uuid,text)'::regprocedure::oid from private.fixture_old_capability_oid")).toBe('t');expect(await sql(actor()+`with changed as(update storage.objects set name=name||'.changed' where name like '${id(201)}/%' returning name)select count(*) from changed`)).toBe('0');expect(await sql(actor()+`select content from public.knowledge_sources where company_id='${id(201)}'`)).toBe('Facts remain');expect(await sql(actor()+`select public.master_business_workspace_allowed('${id(201)}'),public.master_business_workspace_allowed('${id(202)}')`)).toBe('f|t');expect(await sql(`select private.master_activation_can_operate('${id(201)}'),private.channel_operation_allowed('${id(201)}','whatsapp','automate')`)).toBe('f|f');
});
it('concurrent confirmations produce one source, and company-lock wait rechecks retained native session bans',async()=>{
 const p=await stage();const args=`'${id(1)}','${id(201)}','${p.data.id}',1,'${p.data.contentHash}'`;const [a,b]=await Promise.all([call('master_confirm_knowledge_import',args),call('master_confirm_knowledge_import',args)]);expect(a).toEqual(b);expect(await sql('select count(*) from public.knowledge_sources')).toBe('1');
 const h=hold(`begin;select id from public.companies where id='${id(201)}' for update;select 'company-held';`);for(let i=0;i<30&&!h.output().includes('company-held');i++)await sql('select 1');expect(h.output()).toContain('company-held');const waiting=call('master_set_business_archive',`'${id(1)}','${id(201)}',1,true`);for(let i=0;i<30;i++){if(Number(await sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock'"))>0)break;}await sql(`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${id(1)}'`);h.child.stdin.end('commit;\n');await h.done;held.delete(h);expect(await waiting).toMatchObject({ok:false,code:'UNAUTHENTICATED'});
});
