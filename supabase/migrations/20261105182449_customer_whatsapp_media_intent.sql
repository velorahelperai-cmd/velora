begin;

-- A media intent is an immutable extension of the native staff send intent.
-- The file remains in the existing conversation-bound private store; its hash
-- is checked again after claim before bytes can leave the server.
create table private.customer_whatsapp_media_intents (
  intent_id uuid primary key references public.whatsapp_send_intents(id) on delete cascade,
  company_id uuid not null,
  conversation_id uuid not null,
  binding jsonb not null,
  file_id uuid not null,
  filename text not null,
  mime text not null check (mime in ('image/png','image/jpeg','application/pdf')),
  file_digest bytea not null check (octet_length(file_digest)=32),
  caption text not null check (char_length(caption)<=1024),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.customer_whatsapp_media_intents enable row level security;
revoke all on private.customer_whatsapp_media_intents from public,anon,authenticated,service_role;
create index customer_whatsapp_media_file_binding_idx on private.customer_whatsapp_media_intents(company_id,conversation_id,binding,file_id);

create or replace function private.customer_inbox_file_is_bound(cid uuid,channel text,conv uuid,binding_key jsonb,file_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select $2='whatsapp' and exists(select 1 from private.customer_whatsapp_media_intents m
    join public.whatsapp_send_intents i on i.id=m.intent_id
    where m.company_id=$1 and m.conversation_id=$3 and m.binding=$4 and m.file_id=$5
      and i.outcome in ('attempting','accepted','unknown','rejected'))
$$;
revoke all on function private.customer_inbox_file_is_bound(uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create or replace function private.customer_inbox_file_has_intent(cid uuid,channel text,conv uuid,binding_key jsonb,file_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select $2='whatsapp' and exists(select 1 from private.customer_whatsapp_media_intents m
    where m.company_id=$1 and m.conversation_id=$3 and m.binding=$4 and m.file_id=$5)
$$;
revoke all on function private.customer_inbox_file_has_intent(uuid,text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create function private.customer_whatsapp_media_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  raise exception 'MEDIA_BINDING_IMMUTABLE' using errcode='23514';
end; $$;
revoke all on function private.customer_whatsapp_media_immutable() from public,anon,authenticated,service_role;
create trigger customer_whatsapp_media_immutable before update on private.customer_whatsapp_media_intents
for each row execute function private.customer_whatsapp_media_immutable();

-- A legacy text caller must not claim a media-bound intent as a text message.
create function private.customer_whatsapp_media_claim_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.outcome='ready' and new.outcome='attempting'
     and exists(select 1 from private.customer_whatsapp_media_intents m where m.intent_id=old.id)
     and current_setting('velora.customer_media_claim',true) is distinct from old.id::text then
    raise exception 'MEDIA_CLAIM_REQUIRED' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.customer_whatsapp_media_claim_guard() from public,anon,authenticated,service_role;
create trigger customer_whatsapp_media_claim_guard before update of outcome on public.whatsapp_send_intents
for each row execute function private.customer_whatsapp_media_claim_guard();

create function public.create_whatsapp_media_send_intent(
  p_company_id uuid, p_conversation_id uuid, p_file_id uuid, p_client_op_id text,
  p_caption text, p_phone_number_id text, p_link_id uuid default null, p_link_generation bigint default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  binding_key jsonb;
  f private.customer_inbox_extensions%rowtype;
  m private.customer_whatsapp_media_intents%rowtype;
  i public.whatsapp_send_intents%rowtype;
  result jsonb;
  caption text := btrim(coalesce(p_caption,''));
  body text;
begin
  if current_setting('role',true) is distinct from 'authenticated' or actor is null
     or p_company_id is null or p_conversation_id is null or p_file_id is null
     or char_length(caption)>1024 then raise invalid_parameter_value; end if;
  -- Match the native create's conversation-first lock order and avoid waiting
  -- while another operation owns the conversation.
  perform 1 from public.whatsapp_conversations c where c.id=p_conversation_id and c.company_id=p_company_id for update nowait;
  if not found then raise insufficient_privilege; end if;
  binding_key := private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp');
  if binding_key is null or not coalesce(public.has_company_capability(p_company_id,'wa.conversations.reply'),false)
  then raise insufficient_privilege; end if;
  select * into f from private.customer_inbox_extensions e
    where e.company_id=p_company_id and e.channel='whatsapp' and e.conversation_id=p_conversation_id
      and e.binding=binding_key and e.kind='file' and e.item_id=p_file_id for share nowait;
  if not found then raise insufficient_privilege; end if;
  body := coalesce(nullif(caption,''),f.body);
  result := public.create_whatsapp_send_intent(p_client_op_id,p_conversation_id,body,p_phone_number_id,'staff',null,p_link_id,p_link_generation);
  if result->>'ok' is distinct from 'true' then return result; end if;
  select * into i from public.whatsapp_send_intents where id=(result->'intent'->>'id')::uuid for update;
  if not found or i.company_id<>p_company_id or i.conversation_id<>p_conversation_id
     or i.actor_user_id is distinct from actor or i.sender_kind<>'staff' then
    raise exception 'MEDIA_CONFLICT';
  end if;
  select * into m from private.customer_whatsapp_media_intents where intent_id=i.id;
  if found then
    if (m.company_id,m.conversation_id,m.binding,m.file_id,m.filename,m.mime,m.file_digest,m.caption)
      is distinct from (p_company_id,p_conversation_id,binding_key,p_file_id,f.body,f.mime,pg_catalog.sha256(f.bytes),caption)
    then raise exception 'MEDIA_CONFLICT'; end if;
  else
    -- Never convert a previously created text intent into a media intent.
    if result->>'created' is distinct from 'true' then raise exception 'MEDIA_CONFLICT'; end if;
    insert into private.customer_whatsapp_media_intents
      (intent_id,company_id,conversation_id,binding,file_id,filename,mime,file_digest,caption)
    values (i.id,p_company_id,p_conversation_id,binding_key,p_file_id,f.body,f.mime,pg_catalog.sha256(f.bytes),caption);
  end if;
  if private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp') is distinct from binding_key
  then raise insufficient_privilege; end if;
  return result || jsonb_build_object('media_filename',f.body);
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
  when invalid_parameter_value then return jsonb_build_object('ok',false,'code','invalid_input');
  when raise_exception then return jsonb_build_object('ok',false,'code','content_mismatch');
  when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end; $$;
revoke all on function public.create_whatsapp_media_send_intent(uuid,uuid,uuid,text,text,text,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.create_whatsapp_media_send_intent(uuid,uuid,uuid,text,text,text,uuid,bigint) to authenticated;

create function public.claim_whatsapp_media_send_attempt(p_intent_id uuid,p_actor_user_id uuid,p_lease_seconds integer default 90)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare m private.customer_whatsapp_media_intents%rowtype; result jsonb; old_marker text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  select * into m from private.customer_whatsapp_media_intents where intent_id=p_intent_id;
  if not found or not exists(select 1 from private.customer_inbox_extensions e
    where e.company_id=m.company_id and e.channel='whatsapp' and e.conversation_id=m.conversation_id
      and e.binding=m.binding and e.kind='file' and e.item_id=m.file_id
      and e.body=m.filename and e.mime=m.mime and pg_catalog.sha256(e.bytes)=m.file_digest)
  then return jsonb_build_object('ok',false,'code','media_unavailable'); end if;
  old_marker := current_setting('velora.customer_media_claim',true);
  perform set_config('velora.customer_media_claim',p_intent_id::text,true);
  result := public.claim_whatsapp_send_attempt(p_intent_id,p_actor_user_id,p_lease_seconds);
  perform set_config('velora.customer_media_claim',coalesce(old_marker,''),true);
  return result;
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
end; $$;
revoke all on function public.claim_whatsapp_media_send_attempt(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.claim_whatsapp_media_send_attempt(uuid,uuid,integer) to service_role;

create function public.whatsapp_media_claimed_attachment(p_intent_id uuid,p_attempt_token uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare i public.whatsapp_send_intents%rowtype; m private.customer_whatsapp_media_intents%rowtype;
  f private.customer_inbox_extensions%rowtype; current_binding jsonb;
begin
  if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null then raise insufficient_privilege; end if;
  select * into i from public.whatsapp_send_intents where id=p_intent_id for share nowait;
  if not found or i.sender_kind<>'staff' or i.actor_user_id is distinct from auth.uid()
     or i.staff_actor_session_id is null or i.staff_actor_session_id::text is distinct from auth.jwt()->>'session_id'
     or i.outcome<>'attempting' or p_attempt_token is null or i.attempt_token is distinct from p_attempt_token
     or i.attempt_expires_at is null or i.attempt_expires_at<=clock_timestamp()
  then raise insufficient_privilege; end if;
  select * into m from private.customer_whatsapp_media_intents where intent_id=i.id;
  if not found or m.company_id<>i.company_id or m.conversation_id<>i.conversation_id then raise insufficient_privilege; end if;
  current_binding := private.customer_inbox_extension_binding(i.company_id,i.conversation_id,'whatsapp');
  if current_binding is distinct from m.binding or not coalesce(public.has_company_capability(i.company_id,'wa.conversations.reply'),false)
     or not coalesce(private.whatsapp_intent_link_current(i),false) then raise insufficient_privilege; end if;
  select * into f from private.customer_inbox_extensions e
    where e.company_id=m.company_id and e.channel='whatsapp' and e.conversation_id=m.conversation_id
      and e.binding=m.binding and e.kind='file' and e.item_id=m.file_id for share nowait;
  if not found or f.body is distinct from m.filename or f.mime is distinct from m.mime
     or pg_catalog.sha256(f.bytes) is distinct from m.file_digest
     or i.attempt_expires_at<=clock_timestamp()
     or private.customer_inbox_extension_binding(i.company_id,i.conversation_id,'whatsapp') is distinct from m.binding
  then raise insufficient_privilege; end if;
  return jsonb_build_object('ok',true,'intentId',i.id,'attachmentId',m.file_id,'filename',m.filename,
    'mime',m.mime,'caption',m.caption,'base64',replace(encode(f.bytes,'base64'),E'\n',''));
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
  when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end; $$;
revoke all on function public.whatsapp_media_claimed_attachment(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_media_claimed_attachment(uuid,uuid) to authenticated;

-- Attachments are projected only for messages whose native intent has actually
-- been accepted and persisted. A file existing in storage is not delivery.
create function public.whatsapp_media_message_metadata(p_company_id uuid,p_conversation_id uuid,p_message_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare binding_key jsonb; payload jsonb;
begin
  if p_company_id is null or p_conversation_id is null or coalesce(cardinality(p_message_ids),0) not between 1 and 40
     or array_position(p_message_ids,null) is not null then raise invalid_parameter_value; end if;
  binding_key := private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp');
  if binding_key is null then raise insufficient_privilege; end if;
  select coalesce(jsonb_agg(jsonb_build_object('messageId',i.message_id,'attachmentId',m.file_id,
    'filename',m.filename,'mime',m.mime,'caption',m.caption)),'[]'::jsonb) into payload
  from public.whatsapp_send_intents i join private.customer_whatsapp_media_intents m on m.intent_id=i.id
  where i.company_id=p_company_id and i.conversation_id=p_conversation_id and i.outcome='accepted'
    and i.message_id=any(p_message_ids) and m.company_id=i.company_id and m.conversation_id=i.conversation_id
    and m.binding=binding_key;
  if private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp') is distinct from binding_key
  then raise insufficient_privilege; end if;
  return jsonb_build_object('ok',true,'data',payload);
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
  when invalid_parameter_value then return jsonb_build_object('ok',false,'code','invalid_input');
  when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end; $$;
revoke all on function public.whatsapp_media_message_metadata(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_media_message_metadata(uuid,uuid,uuid[]) to authenticated;

-- A discarded draft file must not consume the conversation quota forever.
-- Files bound to any send intent remain immutable history, even if its outcome
-- is uncertain or rejected. Conversation locks serialize against media create.
create function public.customer_inbox_remove_unbound_file(p_company_id uuid,p_conversation_id uuid,p_file_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare binding_key jsonb;
begin
  if p_company_id is null or p_conversation_id is null or p_file_id is null then raise invalid_parameter_value; end if;
  binding_key := private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp');
  if binding_key is null or not coalesce(public.has_company_capability(p_company_id,'wa.conversations.reply'),false)
  then raise insufficient_privilege; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||'whatsapp'||p_conversation_id::text,0));
  if exists(select 1 from private.customer_whatsapp_media_intents m where m.company_id=p_company_id
     and m.conversation_id=p_conversation_id and m.binding=binding_key and m.file_id=p_file_id) then
    return jsonb_build_object('ok',false,'code','in_use');
  end if;
  delete from private.customer_inbox_extensions e where e.company_id=p_company_id and e.channel='whatsapp'
    and e.conversation_id=p_conversation_id and e.binding=binding_key and e.kind='file' and e.item_id=p_file_id;
  if private.customer_inbox_extension_binding(p_company_id,p_conversation_id,'whatsapp') is distinct from binding_key
  then raise insufficient_privilege; end if;
  return jsonb_build_object('ok',true);
exception
  when insufficient_privilege then return jsonb_build_object('ok',false,'code','forbidden');
  when invalid_parameter_value then return jsonb_build_object('ok',false,'code','invalid_input');
  when lock_not_available then return jsonb_build_object('ok',false,'code','unavailable');
end; $$;
revoke all on function public.customer_inbox_remove_unbound_file(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_inbox_remove_unbound_file(uuid,uuid,uuid) to authenticated;

commit;
