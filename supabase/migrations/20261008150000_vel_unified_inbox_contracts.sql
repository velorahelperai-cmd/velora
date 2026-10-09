-- Forward-only Unified Inbox contracts. No provider calls, queue or billing ledger.
begin;
lock table public.whatsapp_conversations,public.whatsapp_messages,public.whatsapp_conversation_events in share row exclusive mode;

create sequence public.whatsapp_inbox_conversation_sequence;
create sequence public.whatsapp_inbox_message_sequence;
create sequence public.whatsapp_inbox_event_sequence;
alter table public.whatsapp_conversations add column inbox_sequence bigint;
alter table public.whatsapp_messages add column arrival_sequence bigint;
alter table public.whatsapp_conversation_events add column event_sequence bigint;
-- Historical arrival order is server creation order, never provider received_at.
with ordered as (select id,row_number() over(order by created_at,id) as seq from public.whatsapp_conversations)
 update public.whatsapp_conversations c set inbox_sequence=o.seq from ordered o where c.id=o.id;
with ordered as (select id,row_number() over(order by created_at,id) as seq from public.whatsapp_messages)
 update public.whatsapp_messages m set arrival_sequence=o.seq from ordered o where m.id=o.id;
-- Existing audit rows reject all UPDATEs. Under the held table lock and this
-- transaction, suspend only that guard to populate the new order column; no
-- existing audit evidence changes. Restore it before any concurrent write.
alter table public.whatsapp_conversation_events disable trigger wa_control_event_persisted_identity;
with ordered as (select id,row_number() over(order by created_at,id) as seq from public.whatsapp_conversation_events)
 update public.whatsapp_conversation_events e set event_sequence=o.seq from ordered o where e.id=o.id;
alter table public.whatsapp_conversation_events enable trigger wa_control_event_persisted_identity;
select pg_catalog.setval('public.whatsapp_inbox_conversation_sequence',coalesce(max(inbox_sequence),1),count(*)>0) from public.whatsapp_conversations;
select pg_catalog.setval('public.whatsapp_inbox_message_sequence',coalesce(max(arrival_sequence),1),count(*)>0) from public.whatsapp_messages;
select pg_catalog.setval('public.whatsapp_inbox_event_sequence',coalesce(max(event_sequence),1),count(*)>0) from public.whatsapp_conversation_events;
alter table public.whatsapp_conversations alter column inbox_sequence set not null,add constraint whatsapp_inbox_sequence_uid unique(inbox_sequence);
alter table public.whatsapp_messages alter column arrival_sequence set not null,add constraint whatsapp_inbox_message_sequence_uid unique(arrival_sequence);
alter table public.whatsapp_conversation_events alter column event_sequence set not null,add constraint whatsapp_inbox_event_sequence_uid unique(event_sequence);
alter sequence public.whatsapp_inbox_conversation_sequence owned by public.whatsapp_conversations.inbox_sequence;
alter sequence public.whatsapp_inbox_message_sequence owned by public.whatsapp_messages.arrival_sequence;
alter sequence public.whatsapp_inbox_event_sequence owned by public.whatsapp_conversation_events.event_sequence;
revoke all on sequence public.whatsapp_inbox_conversation_sequence,public.whatsapp_inbox_message_sequence,public.whatsapp_inbox_event_sequence from public,anon,authenticated,service_role;

create function private.whatsapp_inbox_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 if tg_table_name='whatsapp_conversations' then
  if tg_op='INSERT' then new.inbox_sequence:=pg_catalog.nextval('public.whatsapp_inbox_conversation_sequence');
  elsif new.inbox_sequence is distinct from old.inbox_sequence then raise exception 'immutable_inbox_sequence' using errcode='23514';end if;
 elsif tg_table_name='whatsapp_messages' then
  if tg_op='INSERT' then
   -- Sequence allocation alone is not commit order. Serialize same-thread inserts
   -- BEFORE allocation, preventing a late lower sequence from hiding behind read.
   perform 1 from public.whatsapp_conversations where id=new.conversation_id and company_id=new.company_id for update;
   if not found then raise exception 'message_conversation_scope' using errcode='23503';end if;
   new.arrival_sequence:=pg_catalog.nextval('public.whatsapp_inbox_message_sequence');
  elsif (new.arrival_sequence,new.company_id,new.conversation_id,new.direction)
    is distinct from (old.arrival_sequence,old.company_id,old.conversation_id,old.direction) then
   raise exception 'immutable_message_arrival' using errcode='23514';end if;
 else
  if tg_op='INSERT' then
   perform 1 from public.whatsapp_conversations where id=new.conversation_id and company_id=new.company_id for update;
   if not found then raise exception 'event_conversation_scope' using errcode='23503';end if;
   new.event_sequence:=pg_catalog.nextval('public.whatsapp_inbox_event_sequence');
  elsif (new.event_sequence,new.company_id,new.conversation_id) is distinct from (old.event_sequence,old.company_id,old.conversation_id) then
   raise exception 'immutable_event_sequence' using errcode='23514';end if;
 end if;
 return new;
end; $$;
revoke all on function private.whatsapp_inbox_order_guard() from public,anon,authenticated,service_role;
create trigger whatsapp_inbox_order_guard before insert or update on public.whatsapp_conversations for each row execute function private.whatsapp_inbox_order_guard();
create trigger whatsapp_inbox_order_guard before insert or update on public.whatsapp_messages for each row execute function private.whatsapp_inbox_order_guard();
create trigger whatsapp_inbox_order_guard before insert or update on public.whatsapp_conversation_events for each row execute function private.whatsapp_inbox_order_guard();
create index whatsapp_inbox_company_page_idx on public.whatsapp_conversations(company_id,inbox_sequence desc);
create index whatsapp_inbox_assigned_page_idx on public.whatsapp_conversations(company_id,assigned_to,inbox_sequence desc);
create index whatsapp_inbox_thread_page_idx on public.whatsapp_messages(company_id,conversation_id,arrival_sequence desc);
create index whatsapp_inbox_unread_idx on public.whatsapp_messages(company_id,conversation_id,arrival_sequence) where direction='inbound';
create index whatsapp_inbox_audit_page_idx on public.whatsapp_conversation_events(company_id,conversation_id,event_sequence desc);

-- One durable user marker per thread. No client grants: RPCs exclusively issue
-- displayed boundaries and advance read state after an explicit rendered-page ack.
create table private.whatsapp_inbox_read_markers(
 company_id uuid not null,conversation_id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,
 last_read_sequence bigint not null default 0 check(last_read_sequence>=0),
 displayed_inbound_message_id uuid references public.whatsapp_messages(id) on delete set null,
 displayed_sequence bigint not null default 0 check(displayed_sequence>=0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,conversation_id,user_id),
 foreign key(company_id,conversation_id) references public.whatsapp_conversations(company_id,id) on delete cascade,
 check(last_read_sequence<=displayed_sequence)
);
alter table private.whatsapp_inbox_read_markers enable row level security;
revoke all on table private.whatsapp_inbox_read_markers from public,anon,authenticated,service_role;

create function private.whatsapp_inbox_scope(p_company_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$ declare scope text;begin
 if auth.uid() is null or not coalesce(public.app_session_is_valid(),false)
 or not exists(select 1 from auth.users where id=auth.uid() and (email_confirmed_at is not null or phone_confirmed_at is not null))
 or not exists(select 1 from public.companies where id=p_company_id and status<>'suspended')
 or not coalesce(public.has_company_capability(p_company_id,'wa.conversations.read'),false) then return null;end if;
 scope:=public.company_conversation_scope(p_company_id);
 if scope not in ('all_company','assigned_only') then return null;end if;
 return scope;
end; $$;
revoke all on function private.whatsapp_inbox_scope(uuid) from public,anon,authenticated,service_role;

create function private.whatsapp_inbox_intervention(p_company_id uuid,p_conversation_id uuid,p_human_control boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('reasons',to_jsonb(array_remove(array[
  case when p_human_control then 'human_control' end,
  case when exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
   where j.company_id=p_company_id and m.conversation_id=p_conversation_id and j.status='review_required') then 'worker_review' end,
  case when exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
   where j.company_id=p_company_id and m.conversation_id=p_conversation_id and j.status in ('failed','dead_letter')) then 'worker_failed' end,
  case when exists(select 1 from public.whatsapp_send_intents where company_id=p_company_id and conversation_id=p_conversation_id and outcome='unknown') then 'send_unknown' end,
  case when exists(select 1 from public.whatsapp_send_intents where company_id=p_company_id and conversation_id=p_conversation_id and outcome='rejected') then 'send_rejected' end,
  case when exists(select 1 from public.whatsapp_messages where company_id=p_company_id and conversation_id=p_conversation_id and direction='outbound' and delivery_state='failed') then 'delivery_failed' end
 ]::text[],null)));
$$;
revoke all on function private.whatsapp_inbox_intervention(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function private.whatsapp_inbox_message_public(p_row public.whatsapp_messages) returns jsonb
language sql stable set search_path='' as $$ select jsonb_build_object('id',p_row.id,'arrival_sequence',p_row.arrival_sequence::text,
 'body',p_row.body,'sender',p_row.sender,'direction',p_row.direction,'received_at',p_row.received_at,'delivery_state',p_row.delivery_state);$$;
revoke all on function private.whatsapp_inbox_message_public(public.whatsapp_messages) from public,anon,authenticated,service_role;
create function private.whatsapp_inbox_conversation_public(p_row public.whatsapp_conversations,p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'inbox_sequence',p_row.inbox_sequence::text,'customer_name',p_row.customer_name,
  'customer_wa_id',p_row.customer_wa_id,'last_message_at',p_row.last_message_at,'status',p_row.status,
  'automation_allowed',p_row.automation_allowed,'automation_generation',p_row.automation_generation,
  'control_revision',p_row.control_revision,'assigned_to',p_row.assigned_to,
  'assigned_name',(select member_name from public.company_members where company_id=p_row.company_id and user_id=p_row.assigned_to),
  'lead_stage',p_row.lead_stage,'lead_stage_reason',p_row.lead_stage_reason,'internal_note',p_row.internal_note,
  'follow_up_status',p_row.follow_up_status,'follow_up_at',p_row.follow_up_at,'last_touch_at',p_row.last_touch_at,'lead_revision',p_row.lead_revision,
  'unread_count',(select count(*) from public.whatsapp_messages m where m.company_id=p_row.company_id and m.conversation_id=p_row.id and m.direction='inbound'
   and m.arrival_sequence>coalesce((select last_read_sequence from private.whatsapp_inbox_read_markers where company_id=p_row.company_id and conversation_id=p_row.id and user_id=p_user_id),0)),
  'latest_message',(select private.whatsapp_inbox_message_public(m) from public.whatsapp_messages m
   where m.company_id=p_row.company_id and m.conversation_id=p_row.id order by m.arrival_sequence desc limit 1),
  'intervention',private.whatsapp_inbox_intervention(p_row.company_id,p_row.id,not p_row.automation_allowed and p_row.status<>'resolved'));
$$;
revoke all on function private.whatsapp_inbox_conversation_public(public.whatsapp_conversations,uuid) from public,anon,authenticated,service_role;

create function public.whatsapp_inbox_page(p_company_id uuid,p_limit integer default 50,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope text;items jsonb;more boolean;next_cursor bigint;total bigint;unread bigint;interventions bigint;fingerprint text;
begin
 scope:=private.whatsapp_inbox_scope(p_company_id);
 if scope is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_before<=0 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 -- Page and whole-membership metadata share one statement snapshot. Separate
 -- READ COMMITTED SELECTs could stamp old page IDs with a newly changed hash.
 with membership as materialized(select c from public.whatsapp_conversations c where c.company_id=p_company_id
  and (scope='all_company' or c.assigned_to=auth.uid())),
 eligible as(select c from membership where p_before is null or (c).inbox_sequence<p_before
  order by (c).inbox_sequence desc limit p_limit+1),page as(select c from eligible order by (c).inbox_sequence desc limit p_limit)
 select coalesce(jsonb_agg(private.whatsapp_inbox_conversation_public(c,auth.uid()) order by (c).inbox_sequence desc),'[]'::jsonb),
  (select count(*)>p_limit from eligible),min((c).inbox_sequence),(select count(*) from membership),
  (select count(*) from public.whatsapp_messages m join membership x on (x.c).id=m.conversation_id and (x.c).company_id=m.company_id
   left join private.whatsapp_inbox_read_markers r on r.company_id=m.company_id and r.conversation_id=m.conversation_id and r.user_id=auth.uid()
   where m.direction='inbound' and m.arrival_sequence>coalesce(r.last_read_sequence,0)),
  (select count(*) from membership x where jsonb_array_length(private.whatsapp_inbox_intervention((x.c).company_id,(x.c).id,
    not (x.c).automation_allowed and (x.c).status<>'resolved')->'reasons')>0),
  (select pg_catalog.md5(coalesce(string_agg((x.c).id::text,',' order by (x.c).id),'')) from membership x)
 into items,more,next_cursor,total,unread,interventions,fingerprint from page;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_scope',scope,'kind','partial','ordering','newest_created',
  'conversations',items,'has_more',more,'next_cursor',case when more then next_cursor::text end,
  'total',total,'unread_total',unread,'intervention_total',interventions,'membership_fingerprint',fingerprint);
end; $$;

create function public.whatsapp_thread_page(p_company_id uuid,p_conversation_id uuid,p_limit integer default 50,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope text;c public.whatsapp_conversations%rowtype;items jsonb;more boolean;next_cursor bigint;boundary uuid;boundary_sequence bigint;issued uuid;conv jsonb;
begin
 scope:=private.whatsapp_inbox_scope(p_company_id);
 if scope is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_before<=0 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 select * into c from public.whatsapp_conversations where id=p_conversation_id and company_id=p_company_id and (scope='all_company' or assigned_to=auth.uid());
 if not found then return jsonb_build_object('ok',false,'code','not_found');end if;
 with eligible as(select m from public.whatsapp_messages m where m.company_id=p_company_id and m.conversation_id=p_conversation_id
  and (p_before is null or m.arrival_sequence<p_before) order by m.arrival_sequence desc limit p_limit+1),
 page as(select m from eligible order by (m).arrival_sequence desc limit p_limit)
 select coalesce(jsonb_agg(private.whatsapp_inbox_message_public(m) order by (m).arrival_sequence),'[]'::jsonb),
  (select count(*)>p_limit from eligible),min((m).arrival_sequence),
  (array_agg((m).id order by (m).arrival_sequence desc) filter(where (m).direction='inbound'))[1],
  max((m).arrival_sequence) filter(where (m).direction='inbound')
 into items,more,next_cursor,boundary,boundary_sequence from page;
 -- Historical pages cannot replace a latest-page read acknowledgement.
 if p_before is null and boundary is not null then
  insert into private.whatsapp_inbox_read_markers(company_id,conversation_id,user_id,displayed_inbound_message_id,displayed_sequence)
   values(p_company_id,p_conversation_id,auth.uid(),boundary,boundary_sequence)
  on conflict(company_id,conversation_id,user_id) do update set displayed_inbound_message_id=excluded.displayed_inbound_message_id,
   displayed_sequence=excluded.displayed_sequence,updated_at=clock_timestamp()
   where excluded.displayed_sequence>=whatsapp_inbox_read_markers.displayed_sequence
  returning displayed_inbound_message_id into issued;
 end if;
 conv:=private.whatsapp_inbox_conversation_public(c,auth.uid());
 return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_id',p_conversation_id,'kind','partial','conversation',conv,
  'messages',items,'has_more',more,'next_cursor',case when more then next_cursor::text end,
  'displayed_inbound_message_id',issued,'unread_count',conv->'unread_count');
end; $$;

create function public.whatsapp_mark_thread_read(p_company_id uuid,p_conversation_id uuid,p_displayed_inbound_message_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope text;r private.whatsapp_inbox_read_markers%rowtype;unread bigint;
begin
 scope:=private.whatsapp_inbox_scope(p_company_id);
 if scope is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if not exists(select 1 from public.whatsapp_conversations where id=p_conversation_id and company_id=p_company_id and (scope='all_company' or assigned_to=auth.uid())) then
  return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into r from private.whatsapp_inbox_read_markers where company_id=p_company_id and conversation_id=p_conversation_id and user_id=auth.uid() for update;
 if not found or p_displayed_inbound_message_id is null or r.displayed_inbound_message_id is distinct from p_displayed_inbound_message_id
  or not exists(select 1 from public.whatsapp_messages where id=p_displayed_inbound_message_id and company_id=p_company_id
   and conversation_id=p_conversation_id and direction='inbound' and arrival_sequence=r.displayed_sequence) then
  return jsonb_build_object('ok',false,'code','display_changed');end if;
 update private.whatsapp_inbox_read_markers set last_read_sequence=greatest(last_read_sequence,r.displayed_sequence),updated_at=clock_timestamp()
 where company_id=p_company_id and conversation_id=p_conversation_id and user_id=auth.uid() returning * into r;
 select count(*) into unread from public.whatsapp_messages where company_id=p_company_id and conversation_id=p_conversation_id
  and direction='inbound' and arrival_sequence>r.last_read_sequence;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_id',p_conversation_id,'last_read_sequence',r.last_read_sequence::text,'unread_count',unread);
end; $$;

create function public.whatsapp_control_audit_page(p_company_id uuid,p_conversation_id uuid,p_limit integer default 50,p_before bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$ declare scope text;items jsonb;more boolean;next_cursor bigint;begin
 scope:=private.whatsapp_inbox_scope(p_company_id);
 if scope is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_before<=0 then return jsonb_build_object('ok',false,'code','invalid_input');end if;
 if not exists(select 1 from public.whatsapp_conversations where id=p_conversation_id and company_id=p_company_id and (scope='all_company' or assigned_to=auth.uid())) then
  return jsonb_build_object('ok',false,'code','not_found');end if;
 with eligible as(select e from public.whatsapp_conversation_events e where e.company_id=p_company_id and e.conversation_id=p_conversation_id
  and (p_before is null or e.event_sequence<p_before) order by e.event_sequence desc limit p_limit+1),
 page as(select e from eligible order by (e).event_sequence desc limit p_limit)
 select coalesce(jsonb_agg(jsonb_build_object('id',(e).id,'event_sequence',(e).event_sequence::text,'actor_user_id',(e).actor_user_id,
  'action',(e).action,'revision',(e).revision,'automation_generation',(e).automation_generation,'created_at',(e).created_at) order by (e).event_sequence desc),'[]'::jsonb),
  (select count(*)>p_limit from eligible),min((e).event_sequence) into items,more,next_cursor from page;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'conversation_id',p_conversation_id,'kind','partial',
  'events',items,'has_more',more,'next_cursor',case when more then next_cursor::text end);
end; $$;

create function public.whatsapp_inbox_connection_status(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare l public.whatsapp_company_links%rowtype;ready boolean:=false;begin
 if private.whatsapp_inbox_scope(p_company_id) is null then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select * into l from public.whatsapp_company_links where company_id=p_company_id;
 if found then
  ready:=coalesce(l.status='verified' and l.authorization_status='active' and l.authorization_verified_at<=clock_timestamp()
   and l.provider_phone_number_id is not null and l.provider_waba_id is not null and l.access_secret_id is not null
   and l.authorization_app_id is not null and l.authorization_user_id is not null and l.authorization_session_id is not null
   and l.authorization_scopes @> '["whatsapp_business_management","whatsapp_business_messaging"]'::jsonb
   and (l.authorization_expires_at>clock_timestamp() or (l.authorization_expires_at is null and l.authorization_non_expiring)),false);
 end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'connection',jsonb_build_object('status',coalesce(l.status,'not_connected'),
  'display_number',l.verified_display_number,'authorization_status',coalesce(l.authorization_status,'needs_reauth'),
  'receive_ready',ready,'send_ready',ready,'inbound_tested_at',l.inbound_tested_at,'outbound_tested_at',l.outbound_tested_at));
end; $$;
comment on function public.whatsapp_inbox_connection_status(uuid) is 'Connection authorization evidence only. Send readiness does not bypass per-thread service-window, control, billing or cost checks.';

-- Existing direct audit reads must honor assigned-only conversation scope too.
drop policy if exists whatsapp_conversation_events_select_member on public.whatsapp_conversation_events;
create policy whatsapp_conversation_events_select_member on public.whatsapp_conversation_events for select to authenticated
 using(exists(select 1 from public.whatsapp_conversations c where c.company_id=whatsapp_conversation_events.company_id
  and c.id=whatsapp_conversation_events.conversation_id and private.conversation_readable(c.company_id,c.assigned_to)));
revoke all on function public.whatsapp_inbox_page(uuid,integer,bigint),public.whatsapp_thread_page(uuid,uuid,integer,bigint),
 public.whatsapp_mark_thread_read(uuid,uuid,uuid),public.whatsapp_control_audit_page(uuid,uuid,integer,bigint),public.whatsapp_inbox_connection_status(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_inbox_page(uuid,integer,bigint),public.whatsapp_thread_page(uuid,uuid,integer,bigint),
 public.whatsapp_mark_thread_read(uuid,uuid,uuid),public.whatsapp_control_audit_page(uuid,uuid,integer,bigint),public.whatsapp_inbox_connection_status(uuid) to authenticated;
commit;
