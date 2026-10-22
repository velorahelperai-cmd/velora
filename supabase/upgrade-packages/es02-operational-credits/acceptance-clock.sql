-- LOCAL REVIEW CANDIDATE. Native receipt authority; no provider calls or grants
-- of customer credits. Caller wraps all candidate fragments in BEGIN/ROLLBACK.
create table private.es02_operational_recipient_proofs (
 job_id uuid primary key references public.whatsapp_inbound_jobs(id),
 company_id uuid not null references public.companies(id),
 branch_id uuid not null references public.company_branches(id),
 recipient_class text not null check(recipient_class in ('real_customer','test_number')),
 inbound_binding text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.es02_initial_acceptance_receipts (
 company_id uuid primary key references public.companies(id),
 job_id uuid not null unique references public.whatsapp_inbound_jobs(id),
 intent_id uuid not null unique references public.whatsapp_send_intents(id),
 order_id uuid not null references private.es02_account_orders(id),
 branch_id uuid not null references public.company_branches(id),
 provider_message_id text not null unique check(length(btrim(provider_message_id))>0),
 accepted_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.es02_operational_recipient_proofs owner to postgres;
alter table private.es02_initial_acceptance_receipts owner to postgres;
alter table private.es02_operational_recipient_proofs enable row level security;
alter table private.es02_initial_acceptance_receipts enable row level security;
revoke all on private.es02_operational_recipient_proofs,private.es02_initial_acceptance_receipts from public,anon,authenticated,service_role;

create function private.es02_acceptance_evidence_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'ES02_ACCEPTANCE_EVIDENCE_IMMUTABLE' using errcode='23514';
end;$$;
alter function private.es02_acceptance_evidence_immutable() owner to postgres;
revoke all on function private.es02_acceptance_evidence_immutable() from public,anon,authenticated,service_role;
create trigger es02_recipient_proof_immutable before update or delete on private.es02_operational_recipient_proofs
 for each row execute function private.es02_acceptance_evidence_immutable();
create trigger es02_initial_acceptance_immutable before update or delete on private.es02_initial_acceptance_receipts
 for each row execute function private.es02_acceptance_evidence_immutable();

create function private.es02_initial_clock_receipt_guard() returns trigger
language plpgsql set search_path='' as $$begin
 if old.subscription_started_at is not null and new.subscription_started_at is distinct from old.subscription_started_at then
  raise exception 'ES02_INITIAL_CLOCK_IMMUTABLE' using errcode='23514';end if;
 if old.clock_state='ended' and new.clock_state<>'ended' then
  raise exception 'ES02_ENDED_CLOCK_IMMUTABLE' using errcode='23514';end if;
 if old.subscription_started_at is null and (new.subscription_started_at is not null or new.clock_state='active' or new.paid_through_at is not null) then
  if not exists(select 1 from private.es02_initial_acceptance_receipts r
   where r.company_id=new.company_id and r.order_id=new.order_id and r.accepted_at=new.subscription_started_at)
   or new.clock_state<>'active' or new.paid_through_at is distinct from (
    ((new.subscription_started_at at time zone 'Asia/Muscat') + case new.term_unit when 'year' then interval '1 year' else interval '1 month' end
     + make_interval(days=>new.bonus_days)) at time zone 'Asia/Muscat') then
   raise exception 'ES02_INITIAL_CLOCK_ACCEPTANCE_REQUIRED' using errcode='23514';end if;
 end if;
 return new;
end;$$;
alter function private.es02_initial_clock_receipt_guard() owner to postgres;
revoke all on function private.es02_initial_clock_receipt_guard() from public,anon,authenticated,service_role;
create trigger es02_initial_clock_receipt_guard before update of clock_state,subscription_started_at,paid_through_at on private.es02_activation_foundation
 for each row execute function private.es02_initial_clock_receipt_guard();

create function public.es02_classify_claimed_reply(
 p_job_id uuid,p_claim_token uuid,p_configuration_mode text,p_test_phone_number_id text,p_test_recipients text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs; c public.whatsapp_conversations;
 kind text; binding text; previous private.es02_operational_recipient_proofs; review_message boolean:=false;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED');end if;
 if not exists(select 1 from private.es02_activation_foundation where company_id=j.company_id) then
  return jsonb_build_object('ok',true,'recipientClass','legacy');end if;
 select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m
  on m.conversation_id=x.id and m.company_id=x.company_id where m.id=j.message_id and m.company_id=j.company_id
  and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer';
 if c.id is null or c.branch_id is null or p_configuration_mode is null
  or p_configuration_mode not in ('live','meta_test') or p_test_recipients is null
  or cardinality(p_test_recipients)>100 or exists(select 1 from unnest(p_test_recipients) x where x is null or x !~ '^\+?[0-9]{6,20}$') then
  return jsonb_build_object('ok',false,'code','RECIPIENT_CLASSIFICATION_UNAVAILABLE');end if;
 if to_regclass('private.review_whatsapp_inbound') is not null then
  execute 'select exists(select 1 from private.review_whatsapp_inbound where message_id=$1)' into review_message using j.message_id;
 end if;
 kind:=case when p_configuration_mode='meta_test' or review_message
  or c.phone_number_id=p_test_phone_number_id
  or exists(select 1 from unnest(p_test_recipients) x where regexp_replace(x,'[^0-9]','','g')=regexp_replace(c.customer_wa_id,'[^0-9]','','g'))
  then 'test_number' else 'real_customer' end;
 binding:=md5(concat_ws(':',j.company_id,c.branch_id,j.message_id,c.id,c.phone_number_id,c.customer_wa_id));
 select * into previous from private.es02_operational_recipient_proofs where job_id=j.id;
 if previous.job_id is not null and (previous.recipient_class<>kind or previous.inbound_binding<>binding) then
  return jsonb_build_object('ok',false,'code','CLASSIFICATION_CHANGED');end if;
 insert into private.es02_operational_recipient_proofs(job_id,company_id,branch_id,recipient_class,inbound_binding)
 values(j.id,j.company_id,c.branch_id,kind,binding) on conflict(job_id) do nothing;
 return jsonb_build_object('ok',true,'recipientClass',kind);
end;$$;
alter function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) owner to postgres;
revoke all on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) to service_role;

create function private.es02_start_on_accepted_reply(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof record; a private.es02_activation_foundation; started timestamptz; through timestamptz;
begin
 -- Native usage settlement has already authenticated the provider outcome.
 -- Independently require the original inbound, exact intent, successful LIVE
 -- AI execution, held wallet binding and immutable real-recipient snapshot.
 select j.company_id,j.id as job_id,i.id as intent_id,c.branch_id,i.wa_message_id,i.acceptance_observed_at,h.order_group_id
 into proof from public.whatsapp_inbound_jobs j
 join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id
 join public.whatsapp_conversations c on c.id=m.conversation_id and c.company_id=j.company_id
 join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.original_job_id=j.id and i.company_id=j.company_id
  and i.conversation_id=c.id and i.phone_number_id=c.phone_number_id and i.recipient_wa_id=c.customer_wa_id
 join public.ai_usage_ledger l on l.id=j.staged_ai_attempt_id and l.worker_job_id=j.id and l.company_id=j.company_id
  and l.usage_mode='company_live' and l.status='success' and l.response_text=i.body and l.source_citations=j.staged_citations
  and l.automation_generation=j.expected_automation_generation
 join public.billing_subscriptions subscription on subscription.id=j.usage_subscription_id and subscription.company_id=j.company_id and subscription.environment='live'
 join private.es02_reply_credit_holds h on h.job_id=j.id and h.company_id=j.company_id and h.state='accepted'
 join private.es02_activation_foundation foundation on foundation.company_id=j.company_id
  and foundation.order_id=l.es02_order_id and foundation.order_group_id=h.order_group_id
 join private.es02_operational_recipient_proofs r on r.job_id=j.id and r.company_id=j.company_id and r.branch_id=c.branch_id
  and r.recipient_class='real_customer' and r.inbound_binding=md5(concat_ws(':',j.company_id,c.branch_id,j.message_id,c.id,c.phone_number_id,c.customer_wa_id))
 where j.id=p_job_id and j.usage_status='accepted' and m.direction='inbound' and m.sender='customer'
 and l.es02_branch_id=c.branch_id and l.es02_slot_index between 0 and 31
 and l.es02_paid_fingerprint ~ '^[0-9a-f]{64}$' and l.es02_persona in ('noura','lina','dana')
 and i.sender_kind='assistant' and i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
 and i.acceptance_observed_wa_message_id=i.wa_message_id and i.acceptance_observed_at is not null
 and i.acceptance_observed_at<=clock_timestamp() and i.staff_review_grant_id is null
 and coalesce(to_jsonb(i)->>'response_kind','ai_answer_v1')='ai_answer_v1';
 if proof.job_id is null then return jsonb_build_object('ok',false,'code','VERIFIED_OPERATIONAL_ACCEPTANCE_REQUIRED');end if;
 perform 1 from public.companies where id=proof.company_id for no key update;
 select * into a from private.es02_activation_foundation where company_id=proof.company_id for update;
 if a.company_id is null or a.order_group_id<>proof.order_group_id
  or proof.acceptance_observed_at<a.entitlement_created_at or proof.acceptance_observed_at<a.payment_confirmed_at then
  return jsonb_build_object('ok',false,'code','ACCEPTANCE_SCOPE_MISMATCH');end if;
 if a.clock_state in ('active','ended') then
  return jsonb_build_object('ok',true,'reused',true,'clockState',a.clock_state);end if;
 if a.clock_state<>'waiting_readiness' or a.subscription_started_at is not null or a.paid_through_at is not null then
  return jsonb_build_object('ok',false,'code','CLOCK_RECONCILIATION_REQUIRED');end if;
 -- Historical acceptance settles even if readiness/entitlement was later revoked.
 -- No current-authority recheck may erase accepted provider work.
 started:=proof.acceptance_observed_at;
 through:=((started at time zone 'Asia/Muscat') + case a.term_unit when 'year' then interval '1 year' else interval '1 month' end
  + make_interval(days=>a.bonus_days)) at time zone 'Asia/Muscat';
 insert into private.es02_initial_acceptance_receipts(company_id,job_id,intent_id,order_id,branch_id,provider_message_id,accepted_at)
 values(a.company_id,proof.job_id,proof.intent_id,a.order_id,proof.branch_id,proof.wa_message_id,started);
 update private.es02_activation_foundation set clock_state='active',subscription_started_at=started,paid_through_at=through,
  updated_at=clock_timestamp() where company_id=a.company_id and clock_state='waiting_readiness';
 -- Bind the actual accepted start to the existing ES02 live subscription. A
 -- subsequent cancellation/revocation is retained, never automatically revived.
 update public.billing_subscriptions set paid_through=through,
  status=case when status='awaiting_payment' then 'active' else status end
  where company_id=a.company_id and environment='live' and plan_version_id is null and paid_through is null;
 return jsonb_build_object('ok',true,'reused',false,'clockState','active','subscriptionStartedAt',started,'paidThroughAt',through);
end;$$;
alter function private.es02_start_on_accepted_reply(uuid) owner to postgres;
revoke all on function private.es02_start_on_accepted_reply(uuid) from public,anon,authenticated,service_role;

create function private.es02_native_usage_credit_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.es02_reply_credit_holds where job_id=new.id) then return new;end if;
 if new.usage_status in ('accepted','unknown','released') then
  result:=private.es02_settle_reply_credit(new.id,new.usage_status);
  if new.usage_status='accepted' and result->>'ok'='true' then
   perform private.es02_start_on_accepted_reply(new.id);
  end if;
 end if;
 return new;
end;$$;
alter function private.es02_native_usage_credit_settlement() owner to postgres;
revoke all on function private.es02_native_usage_credit_settlement() from public,anon,authenticated,service_role;
create trigger es02_native_usage_credit_settlement after update of usage_status on public.whatsapp_inbound_jobs
 for each row when (old.usage_status is distinct from new.usage_status) execute function private.es02_native_usage_credit_settlement();
