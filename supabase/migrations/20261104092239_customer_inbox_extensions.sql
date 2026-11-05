begin;

-- Bind extensions to the current conversation account and branch. Native inbox
-- authority remains responsible for sessions, membership and assigned-only scope.
create function private.customer_inbox_extension_binding(cid uuid, conv uuid, channel text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  authority jsonb;
  scope text;
  binding jsonb;
begin
  if current_setting('role', true) is distinct from 'authenticated' or actor is null
     or cid is null or conv is null then return null; end if;
  -- This RPC belongs to the company inbox. Branch-only grants use a separate
  -- native reader and must never acquire company inbox extension access.
  perform 1 from public.company_members m
    where m.company_id=cid and m.user_id=actor and m.status='active'
      and not m.es02_branch_only for share nowait;
  if not found then return null; end if;
  if channel = 'whatsapp' then
    scope := private.whatsapp_inbox_scope(cid);
    if scope is null then return null; end if;
    select jsonb_build_array(c.phone_number_id, to_jsonb(c)->>'branch_id') into binding
      from public.whatsapp_conversations c
      where c.company_id=cid and c.id=conv
        and (scope='all_company' or c.assigned_to=actor)
        and private.billing_history_account_allowed(cid, channel, c.phone_number_id)
      for share nowait;
  elsif channel = 'instagram' then
    authority := private.instagram_inbox_authority(cid);
    if authority is null then return null; end if;
    select jsonb_build_array(c.account_id, to_jsonb(c)->>'branch_id') into binding
      from private.instagram_conversations c
      where c.company_id=cid and c.id=conv
        and (authority->>'conversation_scope'='all_company' or c.assigned_to=actor)
        and private.billing_history_account_allowed(cid, channel, c.account_id)
      for share nowait;
    perform private.instagram_inbox_finish(authority);
  end if;
  return binding;
end;
$$;
revoke all on function private.customer_inbox_extension_binding(uuid,uuid,text) from public,anon,authenticated,service_role;

create table private.customer_inbox_extensions (
  company_id uuid not null references public.companies(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','instagram')),
  conversation_id uuid not null,
  binding jsonb not null,
  kind text not null check (kind in ('star','tag','note','file','quick')),
  item_id uuid not null,
  -- Shared conversation history survives removal of its author. A personal
  -- star is separately owned and disappears with that account.
  actor_id uuid references auth.users(id) on delete set null,
  star_owner_id uuid references auth.users(id) on delete cascade,
  body text,
  mime text,
  bytes bytea,
  created_at timestamptz not null default clock_timestamp(),
  primary key (company_id,channel,conversation_id,binding,kind,item_id),
  check ((kind='star' and star_owner_id is not null and item_id=star_owner_id and (actor_id is null or actor_id=star_owner_id) and body is null)
    or (kind<>'star' and star_owner_id is null)),
  check (kind <> 'note' or channel='instagram'),
  check (kind <> 'file' or (body is not null and mime is not null and bytes is not null)),
  check (kind = 'file' or (mime is null and bytes is null)),
  check (bytes is null or octet_length(bytes) between 1 and 524288)
);
alter table private.customer_inbox_extensions enable row level security;
revoke all on table private.customer_inbox_extensions from public,anon,authenticated,service_role;
create unique index customer_inbox_tag_unique on private.customer_inbox_extensions
(company_id,channel,conversation_id,binding,lower(body)) where kind='tag';

-- The media migration replaces this predicate once durable intent bindings
-- exist. Until then all stored files count as unbound drafts.
create function private.customer_inbox_file_is_bound(cid uuid,channel text,conv uuid,binding_key jsonb,file_id uuid)
returns boolean language sql stable security definer set search_path='' as $$ select false $$;
revoke all on function private.customer_inbox_file_is_bound(uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function private.customer_inbox_file_has_intent(cid uuid,channel text,conv uuid,binding_key jsonb,file_id uuid)
returns boolean language sql stable security definer set search_path='' as $$ select false $$;
revoke all on function private.customer_inbox_file_has_intent(uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

-- An internal file is downloaded through the same authorized RPC as its metadata.
-- The table has no client grants and there are no public or signed object URLs.
create function public.customer_inbox_extension(
  p_company_id uuid, p_channel text, p_conversation_id uuid, p_action text,
  p_item_id uuid default null, p_body text default null,
  p_mime text default null, p_base64 text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  binding_key jsonb;
  actor uuid := auth.uid();
  item uuid := p_item_id;
  item_kind text;
  item_body text := btrim(p_body);
  content bytea;
  payload jsonb;
  ext private.customer_inbox_extensions%rowtype;
begin
  binding_key := private.customer_inbox_extension_binding(p_company_id,p_conversation_id,p_channel);
  if binding_key is null then raise insufficient_privilege; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.item_id,'kind',r.kind,
      'body',r.body,'mime',r.mime,'createdAt',r.created_at,'removable',r.removable) order by r.created_at desc),'[]')
    into payload from (
      select ranked.item_id,ranked.kind,ranked.body,ranked.mime,ranked.created_at,ranked.removable from (
      select e.item_id,e.kind,e.body,e.mime,e.created_at,
        case when e.kind='file' then not private.customer_inbox_file_has_intent(e.company_id,e.channel,e.conversation_id,e.binding,e.item_id) else null end as removable,
        row_number() over(partition by e.kind order by
          case when e.kind='file' and private.customer_inbox_file_is_bound(e.company_id,e.channel,e.conversation_id,e.binding,e.item_id) then 1 else 0 end,
          e.created_at desc,e.item_id) as kind_rank
      from private.customer_inbox_extensions e
      where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=p_conversation_id
        and e.binding=binding_key and (e.kind<>'star' or e.actor_id=actor)
      ) ranked where ranked.kind_rank <= 20
      order by ranked.created_at desc,ranked.item_id limit 100
    ) r;
  elsif p_action='download' then
    select * into ext from private.customer_inbox_extensions e
    where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=p_conversation_id
      and e.binding=binding_key and e.kind='file' and e.item_id=item;
    if not found then raise insufficient_privilege; end if;
    payload := jsonb_build_object('name',ext.body,'mime',ext.mime,'base64',replace(encode(ext.bytes,'base64'),E'\n',''));
  elsif p_action in ('star','unstar','tag','untag','note','file','quick','unquick') then
    -- Serialize the per-thread quota and same-ID retries under the native read lock.
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||p_channel||p_conversation_id::text,0));
    if p_action in ('star','unstar') then
      item := actor;
      item_kind := 'star';
      item_body := null;
    else
      if not coalesce(public.has_company_capability(p_company_id,
         case when p_channel='instagram' then 'ig.conversations.reply' else 'wa.conversations.reply' end),false)
      then raise insufficient_privilege; end if;
      item_kind := case when p_action='untag' then 'tag' when p_action='unquick' then 'quick' else p_action end;
      if item is null then raise invalid_parameter_value; end if;
    end if;
    if p_action in ('untag','unstar','unquick') then
      delete from private.customer_inbox_extensions e
      where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=p_conversation_id
        and e.binding=binding_key and e.kind=item_kind and e.item_id=item;
    else
      if item_kind='tag' and coalesce(char_length(item_body),0) not between 1 and 32 then raise invalid_parameter_value; end if;
      if item_kind='quick' and coalesce(char_length(item_body),0) not between 1 and 250 then raise invalid_parameter_value; end if;
      if item_kind='note' and (p_channel<>'instagram' or coalesce(char_length(item_body),0) not between 1 and 2000)
      then raise invalid_parameter_value; end if;
      if item_kind='file' then
        if item_body is null or item_body !~ '^[[:alnum:]_. -]{1,100}$'
          or p_base64 is null or length(p_base64)>699052
          or p_mime is null or p_mime not in ('image/png','image/jpeg','application/pdf')
        then raise invalid_parameter_value; end if;
        content := decode(p_base64,'base64');
        if octet_length(content) not between 1 and 524288 or not (
          (p_mime='image/png' and substring(content from 1 for 8)=decode('89504e470d0a1a0a','hex')) or
          (p_mime='image/jpeg' and substring(content from 1 for 3)=decode('ffd8ff','hex')) or
          (p_mime='application/pdf' and substring(content from 1 for 5)=decode('255044462d','hex'))
        ) then raise invalid_parameter_value; end if;
      end if;
      select * into ext from private.customer_inbox_extensions e
      where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=p_conversation_id
        and e.binding=binding_key and e.kind=item_kind and e.item_id=item;
      if found then
        if ext.actor_id is distinct from actor or ext.body is distinct from item_body
           or ext.mime is distinct from (case when item_kind='file' then p_mime end)
           or ext.bytes is distinct from content then
          return jsonb_build_object('ok',false,'code','CONFLICT');
        end if;
      else
        if item_kind<>'star' and (select count(*) from private.customer_inbox_extensions e
          where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=p_conversation_id
            and e.binding=binding_key and e.kind=item_kind
            and (item_kind<>'file' or not private.customer_inbox_file_is_bound(e.company_id,e.channel,e.conversation_id,e.binding,e.item_id))) >= (case when item_kind='file' then 10 else 20 end)
        then return jsonb_build_object('ok',false,'code','LIMIT'); end if;
        insert into private.customer_inbox_extensions
          (company_id,channel,conversation_id,binding,kind,item_id,actor_id,star_owner_id,body,mime,bytes)
        values (p_company_id,p_channel,p_conversation_id,binding_key,item_kind,item,actor,case when item_kind='star' then actor end,item_body,
                case when item_kind='file' then p_mime end,content);
      end if;
    end if;
    payload := to_jsonb(item);
  else
    raise invalid_parameter_value;
  end if;
  if private.customer_inbox_extension_binding(p_company_id,p_conversation_id,p_channel)
     is distinct from binding_key then raise insufficient_privilege; end if;
  return jsonb_build_object('ok',true,'data',payload);
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
  when invalid_parameter_value then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  when unique_violation then return jsonb_build_object('ok',false,'code','CONFLICT');
  when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;
$$;
revoke all on function public.customer_inbox_extension(uuid,text,uuid,text,uuid,text,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.customer_inbox_extension(uuid,text,uuid,text,uuid,text,text,text)
to authenticated;

-- A bounded list read avoids one RPC per loaded row. Every requested thread is
-- independently checked by the same native binding used by individual writes.
create function public.customer_inbox_star_batch(p_company_id uuid, p_channel text, p_conversation_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  conv uuid;
  binding_key jsonb;
  bindings jsonb := '{}'::jsonb;
  starred uuid[] := array[]::uuid[];
  actor uuid := auth.uid();
begin
  if p_company_id is null or p_channel is null or p_channel not in ('whatsapp','instagram')
     or coalesce(cardinality(p_conversation_ids),0) not between 1 and 40
     or array_position(p_conversation_ids,null) is not null then
    raise invalid_parameter_value;
  end if;
  -- Stable lock ordering avoids opposite-order batches waiting on each other.
  for conv in select distinct id from unnest(p_conversation_ids) id order by id loop
    binding_key := private.customer_inbox_extension_binding(p_company_id,conv,p_channel);
    if binding_key is null then raise insufficient_privilege; end if;
    bindings := bindings || jsonb_build_object(conv::text,binding_key);
    if exists (select 1 from private.customer_inbox_extensions e
      where e.company_id=p_company_id and e.channel=p_channel and e.conversation_id=conv
        and e.binding=binding_key and e.kind='star' and e.actor_id=actor) then
      starred := array_append(starred,conv);
    end if;
  end loop;
  for conv in select distinct id from unnest(p_conversation_ids) id order by id loop
    if private.customer_inbox_extension_binding(p_company_id,conv,p_channel)
      is distinct from bindings->(conv::text) then raise insufficient_privilege; end if;
  end loop;
  return jsonb_build_object('ok',true,'data',to_jsonb(starred));
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','FORBIDDEN');
  when invalid_parameter_value then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
end;
$$;
revoke all on function public.customer_inbox_star_batch(uuid,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.customer_inbox_star_batch(uuid,text,uuid[]) to authenticated;
commit;
