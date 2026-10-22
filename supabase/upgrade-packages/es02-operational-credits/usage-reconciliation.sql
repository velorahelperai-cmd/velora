-- Idempotent reconciliation preserves durable native provider evidence even
-- when accounting needs a later repair. No resend, refund or new credit grant.
create function private.es02_native_reply_outcome_proven(p_job_id uuid,p_state text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('accepted','released') then return false;end if;
 return exists(
  select 1 from public.whatsapp_inbound_jobs j
  join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id
  join public.whatsapp_conversations c on c.id=m.conversation_id and c.company_id=j.company_id
  join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.original_job_id=j.id and i.company_id=j.company_id
   and i.conversation_id=c.id and i.phone_number_id=c.phone_number_id and i.recipient_wa_id=c.customer_wa_id
  join public.ai_usage_ledger l on l.id=j.staged_ai_attempt_id and l.worker_job_id=j.id and l.company_id=j.company_id
   and l.usage_mode='company_live' and l.status='success' and l.response_text=i.body and l.source_citations=j.staged_citations
   and l.automation_generation=j.expected_automation_generation and l.es02_branch_id=c.branch_id
  join private.es02_reply_credit_holds h on h.job_id=j.id and h.company_id=j.company_id
  join private.es02_account_orders o on o.id=l.es02_order_id and o.provisioned_company_id=j.company_id and o.original_order_group_id=h.order_group_id
  where j.id=p_job_id and j.usage_status=p_state and m.direction='inbound' and m.sender='customer'
   and i.sender_kind='assistant' and i.expected_automation_generation=j.expected_automation_generation
   and l.es02_slot_index between 0 and 31 and l.es02_paid_fingerprint ~ '^[0-9a-f]{64}$'
   and l.es02_persona in ('noura','lina','dana')
   and ((p_state='accepted' and i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
     and i.acceptance_observed_wa_message_id=i.wa_message_id and i.acceptance_observed_at is not null)
    or (p_state='released' and i.outcome='rejected' and i.wa_message_id is null
     and i.acceptance_observed_wa_message_id is null and i.acceptance_observed_at is null))
 );
end;$$;
alter function private.es02_native_reply_outcome_proven(uuid,text) owner to postgres;
revoke all on function private.es02_native_reply_outcome_proven(uuid,text) from public,anon,authenticated,service_role;

create function private.es02_reconcile_native_reply_credit(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;j public.whatsapp_inbound_jobs;r jsonb;kind text;clock_state text;
begin
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id;
 if h.job_id is null then return jsonb_build_object('ok',true,'legacy',true);end if;
 perform 1 from public.companies where id=h.company_id for no key update;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=h.company_id for update;
 if j.usage_status='unknown' then return private.es02_settle_reply_credit(p_job_id,'unknown');end if;
 if j.usage_status not in ('accepted','released') or j.usage_status is null then
  return jsonb_build_object('ok',false,'code','ES02_ACCOUNTING_PENDING');end if;
 if not private.es02_native_reply_outcome_proven(p_job_id,j.usage_status) then
  -- A raw released status is not provider rejection proof. Keep capacity held.
  if h.state in ('held','unknown') then perform private.es02_settle_reply_credit(p_job_id,'unknown');end if;
  return jsonb_build_object('ok',false,'code','ES02_PROVIDER_OUTCOME_PROOF_REQUIRED','status',j.usage_status);
 end if;
 r:=private.es02_settle_reply_credit(p_job_id,j.usage_status);
 if r->>'ok' is distinct from 'true' or j.usage_status<>'accepted' then return r;end if;
 select recipient_class into kind from private.es02_operational_recipient_proofs where job_id=p_job_id and company_id=h.company_id;
 if kind='test_number' then return r||jsonb_build_object('clock','excluded_test_number');end if;
 if kind is distinct from 'real_customer' then return jsonb_build_object('ok',false,'code','RECIPIENT_CLASSIFICATION_REQUIRED','status','accepted');end if;
 select a.clock_state into clock_state from private.es02_activation_foundation a where a.company_id=h.company_id;
 if clock_state in ('active','ended') then return r||jsonb_build_object('clock','already_started');end if;
 r:=private.es02_start_on_accepted_reply(p_job_id);
 if r->>'ok' is distinct from 'true' then
  return jsonb_build_object('ok',false,'code','ES02_CLOCK_RECONCILIATION_REQUIRED','status','accepted');end if;
 return jsonb_build_object('ok',true,'status','accepted','clock','started');
end;$$;
alter function private.es02_reconcile_native_reply_credit(uuid) owner to postgres;
revoke all on function private.es02_reconcile_native_reply_credit(uuid) from public,anon,authenticated,service_role;

-- A retry/reconciliation of an already accepted native job MUST attempt the
-- wallet/clock again. A status-change-only trigger is insufficient.
alter function public.billing_finalize_automated_usage(uuid,uuid) set schema private;
alter function private.billing_finalize_automated_usage(uuid,uuid) rename to es02_pre_usage_settlement;
revoke all on function private.es02_pre_usage_settlement(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_finalize_automated_usage(p_company_id uuid,p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare native jsonb; accounting jsonb; job uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 native:=private.es02_pre_usage_settlement(p_company_id,p_intent_id);
 select id into job from public.whatsapp_inbound_jobs where company_id=p_company_id and send_intent_id=p_intent_id;
 if job is null then return native;end if;
 -- Only this inner accounting work rolls back on an internal error; the native
 -- receipt/outcome above survives and prevents another provider attempt.
 begin
  accounting:=private.es02_reconcile_native_reply_credit(job);
 exception when others then
  accounting:=jsonb_build_object('ok',false,'code','ES02_ACCOUNTING_PENDING');
 end;
 if accounting->>'ok' is distinct from 'true' then
  return native||jsonb_build_object('ok',false,'code',accounting->>'code','accounting','pending');end if;
 return native||jsonb_build_object('accounting','settled');
end;$$;
alter function public.billing_finalize_automated_usage(uuid,uuid) owner to postgres;
revoke all on function public.billing_finalize_automated_usage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_finalize_automated_usage(uuid,uuid) to service_role;

-- Native paths which update usage directly still reconcile. Internal errors must
-- not erase an already observed provider receipt; the public replay repairs it.
create or replace function private.es02_native_usage_credit_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.es02_reply_credit_holds where job_id=new.id) then
  begin
   perform private.es02_reconcile_native_reply_credit(new.id);
  exception when others then
   raise log '{"error_code":"ES02_ACCOUNTING_PENDING","operation":"native_usage_settlement"}';
  end;
 end if;
 return new;
end;$$;
