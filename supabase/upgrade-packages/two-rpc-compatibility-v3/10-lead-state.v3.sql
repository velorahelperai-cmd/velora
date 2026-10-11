-- REVIEW CANDIDATE: NOT APPROVED FOR PRODUCTION. Actual isolated PostgreSQL evidence accompanies this package; independent approval remains pending.
begin;set local lock_timeout='2s';set local statement_timeout='30s';
do $$ declare d record;begin
 if to_regprocedure('public.upsert_conversation_lead_state(uuid,integer,text,text,text,text,timestamptz)') is not null
 or to_regprocedure('private.whatsapp_conversations_guard_lead()') is not null
 then raise exception 'LEAD_REPAIR_ALREADY_PRESENT_OR_PARTIAL' using errcode='55000';end if;
 if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid='public.whatsapp_conversations'::regclass)
 then raise exception 'LEAD_TABLE_OWNER_MISMATCH' using errcode='55000';end if;
 for d in select * from (values
 ('public.has_company_capability(uuid,text)','71b77d37cd0e9e4d59c26aec47897de5'),
 ('private.conversation_readable(uuid,uuid)','ff8d27e0473b1c060266e2ae54d0e738'),
 ('public.check_app_session(boolean)','f69c473d94466a93d1d793bbd447478e')) v(sig,hash) loop
 if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure(d.sig) and md5(replace(prosrc,chr(13),''))=d.hash and prosecdef and array_to_string(proconfig,',')='search_path=""')
 then raise exception 'LEAD_PREREQUISITE_CHANGED: %',d.sig using errcode='55000';end if;end loop;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='whatsapp_conversations'
 and column_name in ('lead_stage','lead_stage_reason','internal_note','follow_up_status','follow_up_at','last_touch_at','lead_revision','assigned_to','control_revision'))<>9
 then raise exception 'LEAD_COLUMNS_MISSING' using errcode='55000';end if;
 if (select count(*) from pg_catalog.pg_constraint where conrelid='public.whatsapp_conversations'::regclass and convalidated and conname in
 ('whatsapp_conversations_lead_stage_chk','whatsapp_conversations_follow_up_status_chk','whatsapp_conversations_follow_up_active_chk','whatsapp_conversations_lead_revision_chk'))<>4
 then raise exception 'LEAD_CONSTRAINTS_MISSING' using errcode='55000';end if;
end;$$;
-- Invoker trigger distinguishes the RPC table owner from direct authenticated/service DML.
-- A client-set GUC alone must never grant write authority.
create function private.whatsapp_conversations_guard_lead() returns trigger
language plpgsql set search_path='' as $$ begin
 if row(new.lead_stage,new.lead_stage_reason,new.internal_note,new.follow_up_status,new.follow_up_at,new.lead_revision)
 is distinct from row(old.lead_stage,old.lead_stage_reason,old.internal_note,old.follow_up_status,old.follow_up_at,old.lead_revision)
 and (coalesce(current_setting('velora.conversation_lead',true),'')<>'1'
 or current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=tg_relid))
 then raise exception 'lead_columns_locked' using errcode='42501';end if;return new;end;$$;
revoke all on function private.whatsapp_conversations_guard_lead() from public,anon,authenticated,service_role;
create trigger whatsapp_conversations_guard_lead before update on public.whatsapp_conversations
for each row execute function private.whatsapp_conversations_guard_lead();
create function private.wa_lead_session_authority(p_actor uuid,p_session uuid,p_company uuid,p_assigned uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare manager uuid; member_role text; session_deadline timestamptz; now_at timestamptz;begin
 if current_setting('role',true)<>'authenticated' or auth.uid() is distinct from p_actor
 or p_actor is null or p_session is null or (auth.jwt()->>'session_id') is distinct from p_session::text then return false;end if;
 -- Business locks come first. NOWAIT avoids cycles with session deletion,
 -- profile edits and multi-statement membership/delegation revocation.
 perform 1 from auth.users where id=p_actor for share nowait;if not found then return false;end if;
 select (to_jsonb(s)->>'not_after')::timestamptz into session_deadline from auth.sessions s
 where s.id=p_session and s.user_id=p_actor for share nowait;if not found then return false;end if;
 -- Activity was initialized by the existing authenticated access path.
 -- Missing history fails closed; never wait on it before the NOWAIT lock.
 perform 1 from private.app_session_activity where session_id=p_session and user_id=p_actor for update nowait;
 if not found then return false;end if;
 select role into member_role from public.company_members where company_id=p_company and user_id=p_actor for share nowait;
 if not found then return false;end if;
 if member_role='staff' then
  select manager_user_id into manager from public.company_member_grants where company_id=p_company and user_id=p_actor for share nowait;
  if not found then return false;end if;
  if manager is not null then
   perform 1 from public.platform_admins where user_id=manager for share nowait;if not found then return false;end if;
   perform 1 from public.platform_admin_scopes where admin_user_id=manager and company_id=p_company for share nowait;
   if not found then return false;end if;
  end if;
 end if;
 now_at:=clock_timestamp();
 return (public.check_app_session(false)->>'ok')='true'
 and coalesce((auth.jwt()->>'exp')::numeric,0)>extract(epoch from now_at)
 and (session_deadline is null or session_deadline>now_at)
 and exists(select 1 from auth.users u where id=p_actor and (email_confirmed_at is not null or phone_confirmed_at is not null)
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp())
 and exists(select 1 from public.company_members where company_id=p_company and user_id=p_actor and status='active' and role in ('owner','staff'))
 and private.user_has_company_capability(p_actor,p_company,'wa.conversations.reply')
 and private.user_has_company_capability(p_actor,p_company,'wa.conversations.read')
 and private.user_conversation_readable(p_actor,p_company,p_assigned);
 exception when lock_not_available or invalid_text_representation or numeric_value_out_of_range then return false;
end; $$;
revoke all on function private.wa_lead_session_authority(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.upsert_conversation_lead_state(
  p_conversation_id uuid,
  p_expected_revision integer,
  p_lead_stage text,
  p_lead_stage_reason text,
  p_internal_note text,
  p_follow_up_status text,
  p_follow_up_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  v_stage text := pg_catalog.btrim(coalesce(p_lead_stage, ''));
  v_reason text := coalesce(p_lead_stage_reason, '');
  v_note text := coalesce(p_internal_note, '');
  v_fu_status text := pg_catalog.btrim(coalesce(p_follow_up_status, ''));
  v_fu_at timestamptz := p_follow_up_at;
  v_conv public.whatsapp_conversations%rowtype;
  v_company public.companies%rowtype;
  v_company_id uuid;
  v_updated public.whatsapp_conversations%rowtype;
begin
  if current_setting('role',true) is distinct from 'authenticated' or uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','unauthenticated');end;
  if not exists(select 1 from auth.users u where u.id=uid and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
      and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=clock_timestamp()) then
    return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  if p_conversation_id is null or p_expected_revision is null or p_expected_revision < 1 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  -- Manual path hard-blocks subscribed (not only UI).
  if lower(v_stage) = 'subscribed' then
    return jsonb_build_object('ok', false, 'code', 'subscribed_forbidden');
  end if;

  if v_stage not in (
    'new', 'exploring', 'interested', 'trial_or_quote_requested', 'follow_up', 'closed_no_subscribe'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_fu_status not in ('none', 'scheduled', 'completed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if char_length(v_reason) > 2000 or char_length(v_note) > 8000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if v_stage in ('trial_or_quote_requested', 'closed_no_subscribe')
     and pg_catalog.btrim(v_reason) = '' then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  select company_id into v_company_id
  from public.whatsapp_conversations
  where id = p_conversation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Retain company authority before the conversation and all actor locks.
  -- SHARE conflicts with status changes; NOWAIT fails closed on row contention.
  begin
    select * into v_company
    from public.companies
    where id = v_company_id
    for share nowait;
  exception when lock_not_available then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end;
  if not found or v_company.status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_conv
  from public.whatsapp_conversations
  where id = p_conversation_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_conv.company_id is distinct from v_company_id then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if not private.wa_lead_session_authority(uid,sid,v_conv.company_id,v_conv.assigned_to) then
    return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  -- Capabilities + visibility in the same transaction as the write.
  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.read') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not public.has_company_capability(v_conv.company_id, 'wa.conversations.reply') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if not private.conversation_readable(v_conv.company_id, v_conv.assigned_to) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if v_conv.lead_revision is distinct from p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'lead_stage', v_conv.lead_stage,
        'lead_stage_reason', v_conv.lead_stage_reason,
        'internal_note', v_conv.internal_note,
        'follow_up_status', v_conv.follow_up_status,
        'follow_up_at', v_conv.follow_up_at,
        'last_touch_at', v_conv.last_touch_at,
        'lead_revision', v_conv.lead_revision,
        'assigned_to', v_conv.assigned_to,
        'control_revision', v_conv.control_revision
      )
    );
  end if;

  if v_fu_status = 'none' then
    v_fu_at := null;
  elsif v_fu_status = 'scheduled' then
    if v_fu_at is null then
      return jsonb_build_object('ok', false, 'code', 'follow_up_at_required');
    end if;
  else
    -- completed / cancelled: retain historical timestamp
    v_fu_at := coalesce(v_fu_at, v_conv.follow_up_at);
  end if;

  if not private.wa_lead_session_authority(uid,sid,v_conv.company_id,v_conv.assigned_to) then
    return jsonb_build_object('ok',false,'code','unauthenticated');end if;
  perform pg_catalog.set_config('velora.conversation_lead', '1', true);

  update public.whatsapp_conversations as c
  set
    lead_stage = v_stage,
    lead_stage_reason = v_reason,
    internal_note = v_note,
    follow_up_status = v_fu_status,
    follow_up_at = v_fu_at,
    lead_revision = c.lead_revision + 1
  where c.id = v_conv.id
    and c.lead_revision = p_expected_revision
  returning * into v_updated;

  if not found then
    select * into v_conv from public.whatsapp_conversations where id = p_conversation_id;
    return jsonb_build_object(
      'ok', false,
      'code', 'conflict',
      'conversation', jsonb_build_object(
        'id', v_conv.id,
        'lead_stage', v_conv.lead_stage,
        'lead_stage_reason', v_conv.lead_stage_reason,
        'internal_note', v_conv.internal_note,
        'follow_up_status', v_conv.follow_up_status,
        'follow_up_at', v_conv.follow_up_at,
        'last_touch_at', v_conv.last_touch_at,
        'lead_revision', v_conv.lead_revision,
        'assigned_to', v_conv.assigned_to,
        'control_revision', v_conv.control_revision
      )
    );
  end if;

  perform pg_catalog.set_config('velora.conversation_lead', '', true);
  return jsonb_build_object(
    'ok', true,
    'conversation', jsonb_build_object(
      'id', v_updated.id,
      'lead_stage', v_updated.lead_stage,
      'lead_stage_reason', v_updated.lead_stage_reason,
      'internal_note', v_updated.internal_note,
      'follow_up_status', v_updated.follow_up_status,
      'follow_up_at', v_updated.follow_up_at,
      'last_touch_at', v_updated.last_touch_at,
      'lead_revision', v_updated.lead_revision,
      'assigned_to', v_updated.assigned_to,
      'control_revision', v_updated.control_revision
    )
  );
end;
$$;

revoke all on function public.upsert_conversation_lead_state(uuid, integer, text, text, text, text, timestamptz)
  from public, anon, service_role;
grant execute on function public.upsert_conversation_lead_state(uuid, integer, text, text, text, text, timestamptz)
  to authenticated;

notify pgrst,'reload schema';commit;
