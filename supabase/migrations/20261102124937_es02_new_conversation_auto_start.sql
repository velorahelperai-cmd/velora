-- New live conversations may start in AI mode only after an explicit
-- server-side activation for this paid branch. Existing human handovers and
-- imported history are never resumed by this change.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
alter table private.es02_activation_foundation add column ai_auto_start_at timestamptz;

create function private.es02_auto_start_policy_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.ai_auto_start_at is not null then raise exception 'ES02_AUTO_START_REQUIRES_OWNER' using errcode='42501';end if;
  return new;
 end if;
 if current_user is distinct from (select pg_catalog.pg_get_userbyid(relowner) from pg_catalog.pg_class where oid=tg_relid) then
  raise exception 'ES02_AUTO_START_REQUIRES_OWNER' using errcode='42501';end if;
 if new.ai_auto_start_at is not null and (new.ai_auto_start_at>clock_timestamp() or new.ai_auto_start_at<clock_timestamp()-interval '5 minutes'
   or not new.ai_cost_enabled or new.ai_cost_order_id is distinct from new.order_id) then
  raise exception 'ES02_AUTO_START_POLICY_INVALID' using errcode='23514';end if;
 return new;
end;$$;
revoke all on function private.es02_auto_start_policy_guard() from public,anon,authenticated,service_role;
create trigger es02_auto_start_policy_guard before insert or update of ai_auto_start_at on private.es02_activation_foundation
 for each row execute function private.es02_auto_start_policy_guard();

create function private.es02_should_autostart_conversation(p_company uuid,p_phone text,p_received timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare branch uuid; policy private.es02_activation_foundation;
begin
 if p_company is null or p_phone is null or p_received is null or not isfinite(p_received)
  or p_received>clock_timestamp()+interval '5 minutes' or p_received<clock_timestamp()-interval '23 hours' then return false;end if;
 branch:=private.whatsapp_resolve_conversation_branch(p_company,p_phone,clock_timestamp());
 if branch is null or not private.whatsapp_coexistence_ai_allowed(p_company,p_phone) then return false;end if;
 select * into policy from private.es02_activation_foundation where company_id=p_company;
 if not found or policy.ai_auto_start_at is null or p_received<policy.ai_auto_start_at
  or not policy.ai_cost_enabled or policy.ai_cost_order_id is distinct from policy.order_id then return false;end if;
 -- Eligibility persists through a transient readiness outage. Dispatch below
 -- stays blocked until the paid branch is ready and the worker rechecks it.
 return true;
exception when others then
 -- Receipt must not be lost if readiness is temporarily unavailable.
 return false;
end;$$;
revoke all on function private.es02_should_autostart_conversation(uuid,text,timestamptz) from public,anon,authenticated,service_role;

create function private.es02_auto_dispatch_ready(p_company uuid,p_branch uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare policy private.es02_activation_foundation; readiness jsonb;
begin
 select * into policy from private.es02_activation_foundation where company_id=p_company;
 if not found or policy.ai_auto_start_at is null then return true;end if;
 if p_branch is null or not policy.ai_cost_enabled or policy.ai_cost_order_id is distinct from policy.order_id then return false;end if;
 readiness:=private.es02_paid_branch_readiness(p_company,p_branch);
 return readiness->>'ok'='true' and readiness->>'order_id'=policy.order_id::text
  and readiness->>'subscription_id'=policy.ai_cost_subscription_id::text;
exception when others then return false;
end;$$;
revoke all on function private.es02_auto_dispatch_ready(uuid,uuid) from public,anon,authenticated,service_role;

-- Patch only creation of a fresh conversation by the live inbound path. The
-- conflict update never changes control mode for an existing conversation.
do $patch$
declare body text; old_expr text:=E'      ''open'',\n      false\n    )';
 new_expr text:=E'      ''open'',\n      private.es02_should_autostart_conversation(p_company_id,v_phone,p_received_at)\n    )';
begin
 select pg_get_functiondef('private.wa_save_inbound_pre_coexistence(uuid,text,text,text,text,text,text,timestamptz)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'WA_INBOUND_AUTOSTART_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$patch$;

-- Do not claim and permanently hand over a queued message during a temporary
-- readiness outage. The actual claim and send still revalidate authority.
do $dispatch$
declare body text; old_expr text:='and j.next_attempt_at<=clock_timestamp()';
 new_expr text:='and private.es02_auto_dispatch_ready(j.company_id,c.branch_id) and j.next_attempt_at<=clock_timestamp()';
begin
 select pg_get_functiondef('public.whatsapp_claim_inbound_batch(integer)'::regprocedure) into body;
 if (length(body)-length(replace(body,old_expr,'')))/length(old_expr)<>1 then raise exception 'WA_BATCH_AUTOSTART_SOURCE_DRIFT';end if;
 execute replace(body,old_expr,new_expr);
end;$dispatch$;
commit;
