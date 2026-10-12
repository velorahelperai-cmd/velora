-- IG inbox only. Additive to reviewed connection/ingestion, no WA data or grant
-- conversion. Native authenticated RPCs only; never expose private tables/tokens.
begin;
create or replace function private.access_company_capabilities() returns text[]
language sql immutable set search_path='' as $$select array[
 'wa.conversations.read','wa.conversations.reply','wa.conversations.take_over','wa.conversations.resume','wa.conversations.close','wa.conversations.assign',
 'knowledge.read','knowledge.write','knowledge.delete','company.profile.read','company.profile.write','company.staff.manage',
 'ig.conversations.read','ig.conversations.assign']::text[]$$;
-- Preserve old defaults/conversion; existing grants are NOT updated or seeded.
alter table private.instagram_conversations add column inbox_sequence bigint generated always as identity,
 add column assigned_to uuid references auth.users(id) on delete set null,
 add column revision integer not null default 1 check(revision>=1);
alter table private.instagram_messages add column arrival_sequence bigint generated always as identity;
create unique index instagram_conversation_sequence on private.instagram_conversations(inbox_sequence);
create unique index instagram_message_sequence on private.instagram_messages(arrival_sequence);
create index instagram_inbox_company_scope on private.instagram_conversations(company_id,assigned_to,inbox_sequence desc);
create index instagram_thread_sequence on private.instagram_messages(conversation_id,arrival_sequence desc);
create table private.instagram_read_markers(
 conversation_id uuid not null references private.instagram_conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 last_read_sequence bigint not null check(last_read_sequence>0),updated_at timestamptz not null default clock_timestamp(),
 primary key(conversation_id,user_id)
);
create table private.instagram_inbox_tokens(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('inbox','thread','read')),
 company_id uuid not null references public.companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 conversation_id uuid references private.instagram_conversations(id) on delete cascade,
 authority_fingerprint text not null,sequence bigint not null check(sequence>0),
 expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),
 check((kind='inbox' and conversation_id is null) or (kind in ('thread','read') and conversation_id is not null))
);
create index instagram_inbox_token_expiry on private.instagram_inbox_tokens(expires_at);
create table private.instagram_assignment_audit(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
 conversation_id uuid not null references private.instagram_conversations(id) on delete cascade,
 actor_id uuid not null references auth.users(id),before_assignee uuid,after_assignee uuid,
 revision integer not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.instagram_read_markers enable row level security;
alter table private.instagram_inbox_tokens enable row level security;
alter table private.instagram_assignment_audit enable row level security;
revoke all on private.instagram_read_markers,private.instagram_inbox_tokens,private.instagram_assignment_audit,
 private.instagram_conversations,private.instagram_messages from public,anon,authenticated,service_role;
revoke all on sequence private.instagram_conversations_inbox_sequence_seq,private.instagram_messages_arrival_sequence_seq from public,anon,authenticated,service_role;

-- Lock each current authority source before evaluating it. Independent grants
-- and manager-issued grants use the existing capability evaluator, with IG keys.
create function private.instagram_inbox_member(cid uuid,uid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m public.company_members%rowtype;g public.company_member_grants%rowtype;
 manager jsonb;delegation jsonb;scope text;source jsonb;
begin
 perform 1 from public.companies where id=cid and status='active' for share nowait;if not found then return null;end if;
 select * into m from public.company_members where company_id=cid and user_id=uid and status='active' for share nowait;if not found then return null;end if;
 if m.role='owner' then scope:='all_company';source:=jsonb_build_array(m.role,m.status,m.created_at);
 elsif m.role='staff' then
  select * into g from public.company_member_grants where company_id=cid and user_id=uid and status='active' for share nowait;
  if not found or g.conversation_scope not in ('all_company','assigned_only') then return null;end if;
  if g.manager_user_id is not null then
   select jsonb_build_array(role,status,revision) into manager from public.platform_admins where user_id=g.manager_user_id and role='delegated' and status='active' for share nowait;if not found then return null;end if;
   select jsonb_build_array(delegable_capabilities,revision) into delegation from public.platform_admin_scopes where admin_user_id=g.manager_user_id and company_id=cid for share nowait;if not found then return null;end if;
  end if;
  scope:=g.conversation_scope;source:=jsonb_build_array(m.role,m.status,m.created_at,g.capabilities,g.conversation_scope,g.status,g.revision,g.manager_user_id,manager,delegation);
 else return null;end if;
 if not private.user_has_company_capability(uid,cid,'ig.conversations.read') then return null;end if;
 return jsonb_build_object('scope',scope,'source',source);
end;$$;
create function private.instagram_inbox_authority(cid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare uid uuid;sid uuid;native_expiry timestamptz;activity private.app_session_activity%rowtype;member jsonb;deadline timestamptz;
begin
 if current_setting('role',true) is distinct from 'authenticated' or auth.jwt()->>'role' is distinct from 'authenticated' then return null;end if;
 uid:=auth.uid();sid:=(auth.jwt()->>'session_id')::uuid;if uid is null or sid is null or cid is null then return null;end if;
 member:=private.instagram_inbox_member(cid,uid);if member is null then return null;end if;
 perform 1 from auth.users where id=uid and (email_confirmed_at is not null or phone_confirmed_at is not null) for share nowait;if not found then return null;end if;
 select not_after into native_expiry from auth.sessions where id=sid and user_id=uid for share nowait;
 if not found or native_expiry<=clock_timestamp() then return null;end if;
 select * into activity from private.app_session_activity where session_id=sid and user_id=uid for share nowait;
 if not found or activity.expired_at is not null or activity.last_activity_at>clock_timestamp() or activity.last_activity_at<=clock_timestamp()-interval '2 hours' then return null;end if;
 deadline:=least(coalesce(native_expiry,'infinity'::timestamptz),activity.last_activity_at+interval '2 hours');
 return jsonb_build_object('company_id',cid,'actor_id',uid,'session_id',sid,'conversation_scope',member->>'scope','deadline',deadline,
 'fingerprint',encode(sha256(convert_to(jsonb_build_array(cid,uid,sid,member->'source')::text,'UTF8')),'hex'));
exception when invalid_text_representation then return null;
end;$$;
create function private.instagram_inbox_finish(a jsonb,lease_expiry timestamptz default null) returns void
language plpgsql volatile set search_path='' as $$begin
 if lease_expiry<=clock_timestamp() then raise exception 'SCOPE_CHANGED' using errcode='PIG01';end if;
 if a is null or (a->>'deadline')::timestamptz<=clock_timestamp() then raise exception 'FORBIDDEN' using errcode='42501';end if;
end;$$;
create function private.instagram_inbox_binding(a jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('company_id',a->>'company_id','actor_id',a->>'actor_id','conversation_scope',a->>'conversation_scope')
$$;
create function private.instagram_inbox_issue_token(a jsonb,k text,boundary bigint,conv uuid default null) returns uuid
language plpgsql volatile set search_path='' as $$declare token uuid;begin
 insert into private.instagram_inbox_tokens(kind,company_id,user_id,session_id,conversation_id,authority_fingerprint,sequence,expires_at)
 values(k,(a->>'company_id')::uuid,(a->>'actor_id')::uuid,(a->>'session_id')::uuid,conv,a->>'fingerprint',boundary,least((a->>'deadline')::timestamptz,clock_timestamp()+interval '15 minutes')) returning id into token;return token;
end;$$;
create function private.instagram_inbox_token(token uuid,k text,a jsonb,conv uuid default null) returns private.instagram_inbox_tokens
language plpgsql volatile set search_path='' as $$declare t private.instagram_inbox_tokens%rowtype;begin
 select * into t from private.instagram_inbox_tokens where id=token and kind=k and company_id=(a->>'company_id')::uuid
 and user_id=(a->>'actor_id')::uuid and session_id=(a->>'session_id')::uuid and conversation_id is not distinct from conv
 and authority_fingerprint=a->>'fingerprint' and expires_at>clock_timestamp() for share nowait;
 if not found then raise exception 'SCOPE_CHANGED' using errcode='PIG01';end if;return t;
end;$$;
create function private.instagram_inbox_unread(conv uuid,uid uuid) returns bigint
language sql stable set search_path='' as $$select count(*) from private.instagram_messages m where m.conversation_id=conv and m.direction='inbound'
 and m.arrival_sequence>coalesce((select last_read_sequence from private.instagram_read_markers where conversation_id=conv and user_id=uid),0)$$;
create function private.instagram_inbox_message(m private.instagram_messages) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('id',m.id,'arrival_sequence',m.arrival_sequence::text,'direction',m.direction,
 'content_kind',m.content_kind,'content_text',m.content_text,'received_at',m.received_at,'read_observed_at',m.read_observed_at)$$;
create function private.instagram_inbox_item(c private.instagram_conversations,uid uuid) returns jsonb
language sql stable set search_path='' as $$select jsonb_build_object('id',c.id,'inbox_sequence',c.inbox_sequence::text,'account_id',c.account_id,'counterparty_id',c.counterparty_id,
 'assigned_to',c.assigned_to,'revision',c.revision,'last_received_at',c.last_received_at,'unread_count',private.instagram_inbox_unread(c.id,uid),
 'latest_message',(select private.instagram_inbox_message(m) from private.instagram_messages m where m.conversation_id=c.id order by m.arrival_sequence desc limit 1))$$;

create function public.instagram_inbox_page(p_company_id uuid,p_limit integer default 50,p_cursor uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;uid uuid;before_seq bigint;t private.instagram_inbox_tokens%rowtype;c private.instagram_conversations%rowtype;
 rows jsonb:='[]';total bigint;unread bigint;seen integer:=0;last_seq bigint;more boolean:=false;next_token uuid;
begin
 if p_company_id is null or p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_inbox_authority(p_company_id);if a is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;uid:=(a->>'actor_id')::uuid;
 if p_cursor is not null then t:=private.instagram_inbox_token(p_cursor,'inbox',a);before_seq:=t.sequence;end if;
 -- Pin assignment visibility while reading both counts and page. NOWAIT returns
 -- unavailable instead of producing partial counts during a pending transfer.
 perform 1 from private.instagram_conversations where company_id=p_company_id for share nowait;
 select count(*),coalesce(sum(private.instagram_inbox_unread(x.id,uid)),0) into total,unread from private.instagram_conversations x
 where x.company_id=p_company_id and (a->>'conversation_scope'='all_company' or x.assigned_to=uid);
 for c in select * from private.instagram_conversations x where x.company_id=p_company_id and (a->>'conversation_scope'='all_company' or x.assigned_to=uid)
 and (before_seq is null or x.inbox_sequence<before_seq) order by x.inbox_sequence desc limit p_limit+1 loop
  seen:=seen+1;if seen>p_limit then more:=true;exit;end if;
  rows:=rows||jsonb_build_array(private.instagram_inbox_item(c,uid));last_seq:=c.inbox_sequence;
 end loop;
 if more then next_token:=private.instagram_inbox_issue_token(a,'inbox',last_seq);end if;
 perform private.instagram_inbox_finish(a,t.expires_at);
 return private.instagram_inbox_binding(a)||jsonb_build_object('ok',true,'conversations',rows,'total',total,'unread_total',unread,'has_more',more,'next_cursor',next_token);
exception when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','SCOPE_CHANGED');
 when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_thread_page(p_company_id uuid,p_conversation_id uuid,p_limit integer default 50,p_cursor uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;uid uuid;before_seq bigint;t private.instagram_inbox_tokens%rowtype;c private.instagram_conversations%rowtype;m private.instagram_messages%rowtype;
 rows jsonb:='[]';seen integer:=0;last_seq bigint;boundary bigint;more boolean:=false;next_token uuid;receipt uuid;
begin
 if p_company_id is null or p_conversation_id is null or p_limit is null or p_limit<1 or p_limit>100 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_inbox_authority(p_company_id);if a is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;uid:=(a->>'actor_id')::uuid;
 select * into c from private.instagram_conversations where id=p_conversation_id and company_id=p_company_id and (a->>'conversation_scope'='all_company' or assigned_to=uid) for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 if p_cursor is not null then t:=private.instagram_inbox_token(p_cursor,'thread',a,c.id);before_seq:=t.sequence;end if;
 for m in select * from private.instagram_messages where conversation_id=c.id and company_id=p_company_id and (before_seq is null or arrival_sequence<before_seq) order by arrival_sequence desc limit p_limit+1 loop
  seen:=seen+1;if seen>p_limit then more:=true;exit;end if;
  rows:=rows||jsonb_build_array(private.instagram_inbox_message(m));last_seq:=m.arrival_sequence;
  if m.direction='inbound' then boundary:=greatest(boundary,m.arrival_sequence);end if;
 end loop;
 if more then next_token:=private.instagram_inbox_issue_token(a,'thread',last_seq,c.id);end if;
 if p_cursor is null and boundary is not null then receipt:=private.instagram_inbox_issue_token(a,'read',boundary,c.id);end if;
 perform private.instagram_inbox_finish(a,t.expires_at);
 return private.instagram_inbox_binding(a)||jsonb_build_object('ok',true,'conversation_id',c.id,'conversation',private.instagram_inbox_item(c,uid),'messages',rows,'unread_count',private.instagram_inbox_unread(c.id,uid),'has_more',more,'next_cursor',next_token,'read_receipt',receipt);
exception when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','SCOPE_CHANGED');
 when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_mark_thread_read(p_company_id uuid,p_conversation_id uuid,p_read_receipt uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;uid uuid;c private.instagram_conversations%rowtype;t private.instagram_inbox_tokens%rowtype;boundary bigint;
begin
 if p_company_id is null or p_conversation_id is null or p_read_receipt is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_inbox_authority(p_company_id);if a is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;uid:=(a->>'actor_id')::uuid;
 select * into c from private.instagram_conversations where id=p_conversation_id and company_id=p_company_id and (a->>'conversation_scope'='all_company' or assigned_to=uid) for share nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 t:=private.instagram_inbox_token(p_read_receipt,'read',a,c.id);
 if not exists(select 1 from private.instagram_messages where conversation_id=c.id and company_id=p_company_id and arrival_sequence=t.sequence and direction='inbound') then return jsonb_build_object('ok',false,'code','SCOPE_CHANGED');end if;
 insert into private.instagram_read_markers(conversation_id,user_id,last_read_sequence) values(c.id,uid,t.sequence)
 on conflict(conversation_id,user_id) do update set last_read_sequence=greatest(private.instagram_read_markers.last_read_sequence,excluded.last_read_sequence),updated_at=clock_timestamp() returning last_read_sequence into boundary;
 perform private.instagram_inbox_finish(a,t.expires_at);
 return private.instagram_inbox_binding(a)||jsonb_build_object('ok',true,'conversation_id',c.id,'last_read_sequence',boundary::text,'unread_count',private.instagram_inbox_unread(c.id,uid));
exception when sqlstate 'PIG01' then return jsonb_build_object('ok',false,'code','SCOPE_CHANGED');
 when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
create function public.instagram_assign_conversation(p_company_id uuid,p_conversation_id uuid,p_assigned_to uuid,p_expected_revision integer) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a jsonb;uid uuid;c private.instagram_conversations%rowtype;target jsonb;prior uuid;
begin
 if p_company_id is null or p_conversation_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 a:=private.instagram_inbox_authority(p_company_id);if a is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;uid:=(a->>'actor_id')::uuid;
 if not private.user_has_company_capability(uid,p_company_id,'ig.conversations.assign') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into c from private.instagram_conversations where id=p_conversation_id and company_id=p_company_id and (a->>'conversation_scope'='all_company' or assigned_to=uid) for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 if c.revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_assigned_to is not null then target:=private.instagram_inbox_member(p_company_id,p_assigned_to);if target is null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;end if;
 prior:=c.assigned_to;update private.instagram_conversations set assigned_to=p_assigned_to,revision=revision+1 where id=c.id returning * into c;
 insert into private.instagram_assignment_audit(company_id,conversation_id,actor_id,before_assignee,after_assignee,revision) values(p_company_id,c.id,uid,prior,p_assigned_to,c.revision);
 perform private.instagram_inbox_finish(a);
 return private.instagram_inbox_binding(a)||jsonb_build_object('ok',true,'conversation_id',c.id,'assigned_to',c.assigned_to,'revision',c.revision);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;$$;
-- Defeat inherited real public function grants and hostile private defaults.
revoke all on function private.instagram_inbox_member(uuid,uuid),private.instagram_inbox_authority(uuid),
 private.instagram_inbox_finish(jsonb,timestamptz),private.instagram_inbox_binding(jsonb),private.instagram_inbox_issue_token(jsonb,text,bigint,uuid),
 private.instagram_inbox_token(uuid,text,jsonb,uuid),private.instagram_inbox_unread(uuid,uuid),private.instagram_inbox_message(private.instagram_messages),
 private.instagram_inbox_item(private.instagram_conversations,uuid) from public,anon,authenticated,service_role;
revoke all on function public.instagram_inbox_page(uuid,integer,uuid),public.instagram_thread_page(uuid,uuid,integer,uuid),
 public.instagram_mark_thread_read(uuid,uuid,uuid),public.instagram_assign_conversation(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.instagram_inbox_page(uuid,integer,uuid),public.instagram_thread_page(uuid,uuid,integer,uuid),
 public.instagram_mark_thread_read(uuid,uuid,uuid),public.instagram_assign_conversation(uuid,uuid,uuid,integer) to authenticated;
commit;
