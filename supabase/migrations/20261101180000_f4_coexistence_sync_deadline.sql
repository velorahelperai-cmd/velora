-- F4 (NOT APPLIED). Exposes the existing 24h coexistence sync deadline to the owner UI countdown.
-- Read-only change: same owner check, same outputs plus deadline_at. No new writes, grants unchanged.
begin;
create or replace function public.whatsapp_coexistence_read_sync_status(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;c private.whatsapp_coexistence_connections%rowtype;r private.whatsapp_coexistence_sync_requests%rowtype;t text;s text;err integer;items jsonb:='[]'::jsonb;dl timestamptz;begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','FORBIDDEN');end;
 perform 1 from public.companies where id=p_company_id for share;
 if not private.whatsapp_signup_owner_valid(p_company_id,auth.uid(),sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into c from private.whatsapp_coexistence_connections where company_id=p_company_id;
 if c.company_id is null then return jsonb_build_object('ok',false,'code','CONNECTION_UNAVAILABLE');end if;
 foreach t in array array['history','smb_app_state_sync'] loop
  select * into r from private.whatsapp_coexistence_sync_requests where company_id=p_company_id and link_id=c.link_id and link_generation=c.link_generation and sync_type=t;
  err:=null;
  if t='history' then
   select history_error_code into err from private.whatsapp_coexistence_events where company_id=p_company_id and link_id=c.link_id and link_generation=c.link_generation
   and kind='history_chunk' and history_error_code is not null order by (history_error_code=2593109) desc,stored_at,id limit 1;
   s:=case when err is not null then 'failed' when c.history_sync_status in ('completed','syncing','failed','reconcile_required') then c.history_sync_status
    when r.stage in ('claimed','executing','reconcile_required') then 'reconcile_required' when r.stage='requested' then 'pending' else 'not_requested' end;
  else
   s:=case when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=c.link_id and e.link_generation=c.link_generation and e.kind='contact' and e.projection_status<>'projected') then 'reconcile_required'
    when exists(select 1 from private.whatsapp_coexistence_events e where e.company_id=p_company_id and e.link_id=c.link_id and e.link_generation=c.link_generation and e.kind='contact') then 'syncing'
    when r.stage in ('claimed','executing','reconcile_required') then 'reconcile_required' when r.stage='requested' then 'pending' else 'not_requested' end;
  end if;
  -- Contacts have no documented terminal progress marker. Never infer completed.
  items:=items||jsonb_build_array(jsonb_build_object('sync_type',t,'state',s,'requested',r.provider_request_id is not null,'declined',coalesce(err=2593109,false),'error_code',err,'provider_request_id',r.provider_request_id));
 end loop;
 -- F4: same conservative window as private.whatsapp_coexistence_sync_gate (attempt start + 24h).
 select a.created_at+interval '24 hours' into dl from private.whatsapp_coexistence_signup_attempts a
  where a.company_id=p_company_id and a.status='completed' and a.finalized_link_id=c.link_id and a.finalized_link_generation=c.link_generation
  order by a.created_at desc,a.id desc limit 1;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'link_id',c.link_id,'link_generation',c.link_generation,'ai_enabled',false,'syncs',items,'deadline_at',dl);
end; $$;

revoke all on function public.whatsapp_coexistence_read_sync_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_coexistence_read_sync_status(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
