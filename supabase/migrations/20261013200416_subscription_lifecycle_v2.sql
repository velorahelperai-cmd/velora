-- Local development candidate. Never enables workers, AI, channels or email.
begin;
create function private.billing_lifecycle_deadline(t timestamptz,h integer) returns timestamptz language sql immutable set search_path='' as $$select (t at time zone 'UTC'+make_interval(hours=>h)) at time zone 'UTC'$$;
create table private.billing_expiry_episodes(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 subscription_id uuid not null references public.billing_subscriptions(id),receipt_id uuid not null,
 expired_at timestamptz not null check(isfinite(expired_at)),
 disconnect_at timestamptz generated always as (private.billing_lifecycle_deadline(expired_at,720)) stored,
 delete_at timestamptz generated always as (private.billing_lifecycle_deadline(expired_at,1440)) stored,
 cancelled_at timestamptz,disconnected_at timestamptz,purged_at timestamptz,last_checked_at timestamptz not null default clock_timestamp(),
 provider_revocation text not null default 'unconfirmed' check(provider_revocation='unconfirmed'),
 unique(company_id,expired_at)
);
create table private.billing_expiry_email_outbox(
 id uuid primary key default gen_random_uuid(),episode_id uuid not null references private.billing_expiry_episodes(id),
 kind text not null check(kind in ('expired','disconnect_7d','disconnect_24h')),
 due_at timestamptz not null,state text not null default 'queued' check(state in ('queued','claimed','dispatching','accepted','rejected','unknown','cancelled')),
 claim_token uuid,recipient_user_id uuid,recipient_email text,provider_id text,dispatch_until timestamptz,
 unique(episode_id,kind)
);
alter table private.billing_expiry_episodes enable row level security;
alter table private.billing_expiry_email_outbox enable row level security;
revoke all on private.billing_expiry_episodes,private.billing_expiry_email_outbox from public,anon,authenticated,service_role;

-- Reuse qualified financial proof, never a raw date or an environment flag.
create function private.billing_lifecycle_receipt(cid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('receiptId',g.id,'subscriptionId',s.id,'expiredAt',g.applied_paid_through)
 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id
 where s.company_id=cid and s.environment='live' and g.provider_environment='live'
 and s.plan_version_id=g.plan_version_id
 and isfinite(s.paid_through) and s.paid_through=g.applied_paid_through
 order by g.applied_paid_through desc,g.applied_at desc,g.id desc limit 1
$$;
create function private.billing_chat_access(cid uuid,channel text) returns boolean language plpgsql stable security definer set search_path='' as $$declare r jsonb;e timestamptz;begin
 if current_setting('role',true)='authenticated' and not exists(select 1 from public.company_members where company_id=cid and user_id=auth.uid() and status='active') then return false;end if;
 r:=private.billing_lifecycle_receipt(cid);if r is null then return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);end if;
 e:=(r->>'expiredAt')::timestamptz;
 if statement_timestamp()>=e+interval '720 hours' then return false;end if;
 if statement_timestamp()<e and exists(select 1 from private.billing_expiry_episodes where company_id=cid and disconnected_at is not null) then
  if channel='instagram' then return exists(select 1 from private.instagram_company_links l join private.instagram_company_generations g on g.company_id=l.company_id and g.bound_account_id=l.account_id and g.generation=l.generation where l.company_id=cid and l.status='active' and l.authorization_expires_at>statement_timestamp());end if;
  if channel='whatsapp' then return exists(select 1 from public.whatsapp_company_links where company_id=cid and status='verified' and authorization_status='active' and (authorization_expires_at>statement_timestamp() or (authorization_expires_at is null and authorization_non_expiring)));end if;
 end if;return true;
end;$$;
create function private.billing_chat_send(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when private.billing_lifecycle_receipt(cid) is null then
  not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null)
 else exists(select 1 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id and g.plan_version_id=s.plan_version_id
  where s.company_id=cid and s.environment='live' and g.provider_environment='live' and s.paid_through=g.applied_paid_through
   and s.status in ('active','cancel_at_period_end') and g.applied_paid_through>statement_timestamp() and private.billing_service_receipt_eligible(g.id)) end
$$;
create function private.billing_link_management_allowed(cid uuid) returns boolean language sql volatile security definer set search_path='' as $$select coalesce(clock_timestamp()<(private.billing_lifecycle_receipt(cid)->>'expiredAt')::timestamptz+interval '720 hours',true)$$;
create function private.billing_history_account_allowed(cid uuid,channel text,account text) returns boolean language plpgsql stable security definer set search_path='' as $$declare expected text;begin
 if current_setting('role',true)='authenticated' and not public.has_company_capability(cid,case when channel='instagram' then 'ig.conversations.read' else 'wa.conversations.read' end) then return false;end if;
 if channel='instagram' then select bound_account_id into expected from private.instagram_company_generations where company_id=cid;
 elsif channel='whatsapp' then select provider_phone_number_id into expected from public.whatsapp_company_links where company_id=cid;else return false;end if;
 return expected is null or expected=account;
end;$$;
-- Add predicates to the installed native readers/ingress rather than bypassing their gates.
do $$declare oid regprocedure;definition text;patched text;name text;begin
 foreach name in array array['public.instagram_inbox_page(uuid,integer,uuid)','public.instagram_thread_page(uuid,uuid,integer,uuid)','public.instagram_mark_thread_read(uuid,uuid,uuid)','public.instagram_assign_conversation(uuid,uuid,uuid,integer)',
 'public.whatsapp_inbox_page(uuid,integer,bigint)','public.whatsapp_thread_page(uuid,uuid,integer,bigint)','public.whatsapp_mark_thread_read(uuid,uuid,uuid)','public.whatsapp_control_audit_page(uuid,uuid,integer,bigint)'] loop
  oid:=to_regprocedure(name);if oid is null then continue;end if;
  definition:=pg_get_functiondef(oid);
  if name like '%instagram%' then
   patched:=replace(definition,'x.company_id=p_company_id and','x.company_id=p_company_id and private.billing_history_account_allowed(p_company_id,''instagram'',x.account_id) and');
   patched:=replace(patched,'company_id=p_company_id and (a->>','company_id=p_company_id and private.billing_history_account_allowed(p_company_id,''instagram'',account_id) and (a->>');
  else
   patched:=replace(definition,'c.company_id=p_company_id','c.company_id=p_company_id and private.billing_history_account_allowed(p_company_id,''whatsapp'',c.phone_number_id)');
   patched:=replace(patched,'company_id=p_company_id and (scope=','company_id=p_company_id and private.billing_history_account_allowed(p_company_id,''whatsapp'',phone_number_id) and (scope=');
  end if;
  if definition=patched then raise exception 'LIFECYCLE_READER_KERNEL_NOT_MATCHED: %',name;end if;execute patched;
 end loop;
 oid:=to_regprocedure('public.instagram_ingest_webhook(jsonb)');if oid is not null then
  definition:=pg_get_functiondef(oid);patched:=replace(definition,'valid_link:=found and generation=l.generation;','valid_link:=found and generation=l.generation and private.billing_chat_access(l.company_id,''instagram'');');
  if definition=patched then raise exception 'LIFECYCLE_INGRESS_KERNEL_NOT_MATCHED';end if;execute patched;
 end if;
 oid:=to_regprocedure('private.whatsapp_meta_asset_binding(text,text)');if oid is not null then
  definition:=pg_get_functiondef(oid);patched:=replace(definition,'''company_id'',l.company_id','''company_id'',l.company_id');
  -- Coexistence wraps the native asset gate. Preserve its checkpoint handling
  -- and add the deadline only AFTER the underlying operational binding succeeds.
  patched:=replace(definition,'select * into l from public.whatsapp_company_links where id=','if not private.billing_chat_access((gate->>''company_id'')::uuid,''whatsapp'') then return jsonb_build_object(''ok'',false,''eligible'',false,''code'',''subscription_link_grace_elapsed'');end if; select * into l from public.whatsapp_company_links where id=');
  if definition=patched then patched:=replace(definition,'return jsonb_build_object(''ok'',true,''eligible'',true,','if not private.billing_chat_access(cid,''whatsapp'') then return jsonb_build_object(''ok'',false,''eligible'',false,''code'',''subscription_link_grace_elapsed'');end if; return jsonb_build_object(''ok'',true,''eligible'',true,');end if;
  if definition=patched then raise exception 'LIFECYCLE_WA_INGRESS_KERNEL_NOT_MATCHED';end if;execute patched;
 end if;
 -- Owner status is independent of URL/pop-up success and exposes payment separately.
 oid:=to_regprocedure('public.instagram_owner_connection(uuid,text,text)');definition:=pg_get_functiondef(oid);
 patched:=replace(definition,'''contractReady'',ready);','''contractReady'',ready,''subscriptionExpired'',not private.billing_chat_send(p_company_id),''historyAccessible'',private.billing_chat_access(p_company_id,''instagram''));');
 if definition=patched then raise exception 'LIFECYCLE_OWNER_KERNEL_NOT_MATCHED';end if;execute patched;
 oid:=to_regprocedure('public.instagram_start_connection(uuid,uuid,text,text,text,bigint)');definition:=pg_get_functiondef(oid);
 patched:=replace(definition,'if not private.instagram_owner_lock(p_company_id,uid,sid) then','if not private.billing_link_management_allowed(p_company_id) or not private.instagram_owner_lock(p_company_id,uid,sid) then');
 if definition=patched then raise exception 'LIFECYCLE_START_KERNEL_NOT_MATCHED';end if;execute patched;
 oid:=to_regprocedure('public.instagram_finalize_connection(jsonb,uuid)');definition:=pg_get_functiondef(oid);
 patched:=replace(definition,'update private.instagram_company_generations set generation=a.generation','if not private.billing_link_management_allowed(a.company_id) then return jsonb_build_object(''ok'',false,''code'',''FORBIDDEN'');end if; update private.instagram_company_generations set generation=a.generation');
 if definition=patched then raise exception 'LIFECYCLE_FINALIZE_KERNEL_NOT_MATCHED';end if;execute patched;
 oid:=to_regprocedure('private.whatsapp_inbox_scope(uuid)');if oid is not null then definition:=pg_get_functiondef(oid);patched:=replace(definition,'if auth.uid() is null','if not private.billing_chat_access(p_company_id,''whatsapp'') or auth.uid() is null');if definition=patched then raise exception 'LIFECYCLE_WA_SCOPE_KERNEL_NOT_MATCHED';end if;execute patched;end if;
end;$$;

-- Preserve native capability evaluation and tenant/scope rules. This adds time fences.
alter function private.user_has_company_capability(uuid,uuid,text) rename to lifecycle_native_company_capability;
create function private.user_has_company_capability(p_user_id uuid,p_company_id uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$select private.lifecycle_native_company_capability(p_user_id,p_company_id,p_capability)
 and case when p_capability like 'wa.conversations.%' then private.billing_chat_access(p_company_id,'whatsapp') and (p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id))
 when p_capability like 'ig.conversations.%' then private.billing_chat_access(p_company_id,'instagram') and (p_capability='ig.conversations.read' or private.billing_chat_send(p_company_id)) else true end$$;
alter function public.has_company_capability(uuid,text) rename to lifecycle_native_has_company_capability;
revoke all on function public.lifecycle_native_has_company_capability(uuid,text) from public,anon,authenticated,service_role;
create function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean language sql stable security definer set search_path='' as $$select public.lifecycle_native_has_company_capability(p_company_id,p_capability)
 and case when p_capability like 'wa.conversations.%' then private.billing_chat_access(p_company_id,'whatsapp') and (p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id))
 when p_capability like 'ig.conversations.%' then private.billing_chat_access(p_company_id,'instagram') and (p_capability='ig.conversations.read' or private.billing_chat_send(p_company_id)) else true end$$;
revoke all on function public.has_company_capability(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.has_company_capability(uuid,text) to authenticated;
-- Direct RLS and native RPCs must enforce the same stable-account fence.
do $$begin
 if exists(select 1 from pg_policy where polrelid='public.whatsapp_conversations'::regclass and polname='whatsapp_conversations_select') then
 execute 'alter policy whatsapp_conversations_select on public.whatsapp_conversations using (private.conversation_readable(company_id,assigned_to) and private.billing_chat_access(company_id,''whatsapp'') and private.billing_history_account_allowed(company_id,''whatsapp'',phone_number_id))';
 end if;
end;$$;

-- Exact elapsed 30 days, independent of calendar/DST. Reject unsupported new offers.
create or replace function private.billing_compute_paid_through(p_now timestamptz,p_current timestamptz,p_unit text,p_count integer)
returns timestamptz language plpgsql immutable set search_path='' as $$begin
 if not isfinite(p_now) or p_now is null or p_unit is null or p_count is null or (p_current is not null and not isfinite(p_current)) or not ((p_unit='day' and p_count=30) or (p_unit='month' and p_count=1)) then raise exception 'SUBSCRIPTION_PERIOD_MUST_BE_30_DAYS';end if;
 return greatest(p_now,coalesce(p_current,p_now))+interval '720 hours';
end;$$;

create function private.billing_cancel_old_expiry(cid uuid) returns void language plpgsql security definer set search_path='' as $$declare r jsonb;begin
 r:=private.billing_lifecycle_receipt(cid);
 if r is null then return;end if;
 update private.billing_expiry_episodes set cancelled_at=clock_timestamp() where company_id=cid and cancelled_at is null and expired_at<>(r->>'expiredAt')::timestamptz;
 update private.billing_expiry_email_outbox q set state='cancelled' from private.billing_expiry_episodes e where q.episode_id=e.id and e.company_id=cid and e.cancelled_at is not null and q.state in ('queued','claimed');
end;$$;
create function private.billing_cancel_expiry_on_receipt() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform private.billing_cancel_old_expiry(new.company_id);return new;end;$$;
create constraint trigger billing_cancel_expiry_on_receipt after insert on public.billing_settlement_outcomes deferrable initially deferred for each row
 when(new.outcome='granted' and new.provider_environment='live') execute function private.billing_cancel_expiry_on_receipt();

-- Limited to chat relations. Financial ledger rows, invoices, credentials and accounts survive.
-- A ledger's immutable worker_job_id remains historical provenance after retention cleanup.
do $$declare fk record;begin
 for fk in select conname from pg_constraint where conrelid='public.ai_usage_ledger'::regclass and confrelid='public.whatsapp_inbound_jobs'::regclass loop
  execute format('alter table public.ai_usage_ledger drop constraint %I',fk.conname);
 end loop;
end;$$;
comment on column public.ai_usage_ledger.worker_job_id is 'Immutable historical job UUID. Original authorization is verified at reservation; chat retention may remove the job without deleting or rewriting financial usage.';
alter table public.ai_usage_ledger add column response_redacted_at timestamptz;
-- Chat FK cycles are deferred only within the atomic, company-locked purge transaction.
do $$declare fk record;begin
 for fk in select conrelid::regclass rel,conname from pg_constraint where contype='f' and confrelid in ('public.whatsapp_conversations'::regclass,'public.whatsapp_messages'::regclass,'public.whatsapp_inbound_jobs'::regclass,'public.whatsapp_send_intents'::regclass,'private.instagram_conversations'::regclass,'private.instagram_messages'::regclass,'private.instagram_send_intents'::regclass)
 and connamespace in ('public'::regnamespace,'private'::regnamespace) and conrelid<>'public.ai_usage_ledger'::regclass loop
  execute format('alter table %s alter constraint %I deferrable initially immediate',fk.rel,fk.conname);
 end loop;
end;$$;
create function private.billing_purge_chat(cid uuid) returns void language plpgsql security definer set search_path='' as $$declare rel text;wa uuid[];ig uuid[];begin
 select array_agg(id) into wa from public.whatsapp_conversations where company_id=cid;
 select array_agg(id) into ig from private.instagram_conversations where company_id=cid;
 set constraints all deferred;
 if to_regclass('private.instagram_inbound_signatures') is not null then execute 'delete from private.instagram_inbound_signatures s using private.instagram_messages m where m.id=s.message_id and m.company_id=$1' using cid;end if;
 -- Provider account removal receipts are account lifecycle evidence, not chat content.
 if to_regclass('private.whatsapp_coexistence_checkpoint_events') is not null then execute 'delete from private.whatsapp_coexistence_checkpoint_events where company_id=$1 and kind<>''partner_removed''' using cid;end if;
 foreach rel in array array[
 'private.whatsapp_coexistence_history_media','private.whatsapp_coexistence_contacts','private.whatsapp_coexistence_history_phases','private.whatsapp_coexistence_message_sources',
 'private.review_whatsapp_inbound','private.instagram_send_windows','private.instagram_send_intents','public.ai_channel_review_drafts',
 'public.whatsapp_delivery_statuses','public.whatsapp_conversation_events','public.whatsapp_inbound_jobs','public.whatsapp_send_intents','public.whatsapp_messages','private.instagram_messages'] loop
  if to_regclass(rel) is not null then execute format('delete from %s where company_id=$1',rel) using cid;end if;
 end loop;
 if to_regclass('private.whatsapp_coexistence_events') is not null then execute 'delete from private.whatsapp_coexistence_events where company_id=$1 and kind<>''partner_removed''' using cid;end if;
 delete from private.instagram_conversations where company_id=cid;
 delete from public.whatsapp_conversations where company_id=cid;
 update public.ai_usage_ledger set response_text='[conversation content removed by retention policy]',response_redacted_at=clock_timestamp() where company_id=cid and worker_job_id is not null and response_text is not null and response_redacted_at is null;
 -- Current channels persist only media IDs/nontext placeholders, never downloaded Storage files.
 -- Knowledge files and storage.objects are deliberately outside this policy.
end;$$;

create function public.billing_run_expiry_company(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;e private.billing_expiry_episodes%rowtype;n timestamptz;expiry timestamptz;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update; if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 -- Same first lock as verified payment settlement. Read time/evidence AFTER the lock.
 perform private.billing_cancel_old_expiry(p_company_id);r:=private.billing_lifecycle_receipt(p_company_id);n:=clock_timestamp();
 if r is null then return jsonb_build_object('ok',true,'code','NO_PROVEN_SUBSCRIPTION');end if;
 expiry:=(r->>'expiredAt')::timestamptz;
 if n<expiry then return jsonb_build_object('ok',true,'code','ACTIVE');end if;
 insert into private.billing_expiry_episodes(company_id,subscription_id,receipt_id,expired_at) values(p_company_id,(r->>'subscriptionId')::uuid,(r->>'receiptId')::uuid,expiry) on conflict(company_id,expired_at) do nothing;
 select * into e from private.billing_expiry_episodes where company_id=p_company_id and expired_at=expiry for update;
 update private.billing_expiry_episodes set last_checked_at=n where id=e.id;
 if e.cancelled_at is not null then return jsonb_build_object('ok',true,'code','CANCELLED');end if;
 insert into private.billing_expiry_email_outbox(episode_id,kind,due_at) values(e.id,'expired',expiry),(e.id,'disconnect_7d',expiry+interval '552 hours'),(e.id,'disconnect_24h',expiry+interval '696 hours') on conflict(episode_id,kind) do nothing;
 if n>=e.disconnect_at and e.disconnected_at is null then
  -- Local link retirement only. No unregister/delete/number-migration call to Meta.
  update private.instagram_company_links set status='retired' where company_id=p_company_id and status='active';
  update private.instagram_company_generations set generation=greatest(generation,attempt_generation)+1,attempt_generation=greatest(generation,attempt_generation)+1 where company_id=p_company_id;
  update private.instagram_oauth_attempts set status='cancelled' where company_id=p_company_id and status in ('pending','claimed','vault_staged','unknown');
  update public.whatsapp_company_links set status='disconnected',updated_at=n where company_id=p_company_id and status='verified';
  update private.billing_expiry_episodes set disconnected_at=n where id=e.id;
 end if;
 if n>=e.delete_at and e.purged_at is null then
  perform private.billing_purge_chat(p_company_id);
  update private.billing_expiry_episodes set purged_at=n where id=e.id;
 end if;
 return jsonb_build_object('ok',true,'code','PROCESSED','disconnectAt',e.disconnect_at,'deleteAt',e.delete_at,'providerRevocation','unconfirmed');
end;$$;
create function public.billing_expiry_candidates(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit not between 1 and 50 then raise exception 'INVALID_LIMIT';end if;
 return coalesce((select jsonb_agg(company_id) from (select s.company_id from public.billing_subscriptions s left join private.billing_expiry_episodes e on e.company_id=s.company_id and e.expired_at=s.paid_through where s.environment='live' and s.paid_through<=clock_timestamp() and isfinite(s.paid_through) and e.purged_at is null order by coalesce(e.last_checked_at,'-infinity'::timestamptz),s.company_id limit p_limit) s),'[]'::jsonb);
end;$$;

create function public.billing_read_lifecycle(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r jsonb;e timestamptz;begin
 if current_setting('role',true) is distinct from 'authenticated' or not private.instagram_owner_lock(p_company_id,auth.uid(),(auth.jwt()->>'session_id')::uuid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 r:=private.billing_lifecycle_receipt(p_company_id);e:=(r->>'expiredAt')::timestamptz;
 return jsonb_build_object('ok',true,'expiredAt',e,'disconnectAt',e+interval '720 hours','deleteAt',e+interval '1440 hours','readAllowed',private.billing_chat_access(p_company_id,'instagram'));
exception when invalid_text_representation or lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');end;$$;

-- Future mail sender receives a native claim, then must call authorize immediately before HTTP.
create function public.billing_claim_expiry_email() returns jsonb language plpgsql security definer set search_path='' as $$declare q private.billing_expiry_email_outbox%rowtype;e private.billing_expiry_episodes%rowtype;recipient record;r jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into q from private.billing_expiry_email_outbox where state='queued' and due_at<=clock_timestamp() order by due_at,id limit 1;
 if not found then return jsonb_build_object('ok',true,'claim',null);end if;
 select * into e from private.billing_expiry_episodes where id=q.episode_id;
 perform 1 from public.companies where id=e.company_id for update;
 select * into q from private.billing_expiry_email_outbox where id=q.id and state='queued' for update skip locked;
 if not found then return jsonb_build_object('ok',true,'claim',null);end if;
 select * into e from private.billing_expiry_episodes where id=q.episode_id;
 r:=private.billing_lifecycle_receipt(e.company_id);
 if e.cancelled_at is not null or r is null or (r->>'expiredAt')::timestamptz<>e.expired_at or clock_timestamp()>=e.disconnect_at or
 (q.kind='expired' and clock_timestamp()>=e.disconnect_at-interval '168 hours') or (q.kind='disconnect_7d' and clock_timestamp()>=e.disconnect_at-interval '24 hours') then
  update private.billing_expiry_email_outbox set state='cancelled' where id=q.id;return jsonb_build_object('ok',true,'claim',null);end if;
 select u.id,lower(btrim(u.email)) email,c.display_name into recipient from auth.users u join public.company_members m on m.user_id=u.id and m.company_id=e.company_id and m.role='owner' and m.status='active' join public.companies c on c.id=e.company_id
 where u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) limit 1;
 if not found then return jsonb_build_object('ok',true,'claim',null);end if;
 update private.billing_expiry_email_outbox set state='claimed',claim_token=gen_random_uuid(),recipient_user_id=recipient.id,recipient_email=recipient.email,dispatch_until=clock_timestamp()+interval '30 seconds' where id=q.id returning * into q;
 return jsonb_build_object('ok',true,'claim',jsonb_build_object('id',q.id,'claimToken',q.claim_token,'kind',q.kind,'companyName',recipient.display_name,'recipient',recipient.email,'expiredAt',e.expired_at,'disconnectAt',e.disconnect_at,'deleteAt',e.delete_at,'dispatchUntil',q.dispatch_until));
end;$$;
create function public.billing_authorize_expiry_email(p_id uuid,p_claim_token uuid) returns boolean language plpgsql security definer set search_path='' as $$declare q private.billing_expiry_email_outbox%rowtype;e private.billing_expiry_episodes%rowtype;r jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into q from private.billing_expiry_email_outbox where id=p_id and claim_token=p_claim_token and state='claimed';if not found then return false;end if;
 select * into e from private.billing_expiry_episodes where id=q.episode_id;
 perform 1 from public.companies where id=e.company_id for update;
 r:=private.billing_lifecycle_receipt(e.company_id);
 if e.cancelled_at is not null or r is null or (r->>'expiredAt')::timestamptz<>e.expired_at or clock_timestamp()>=e.disconnect_at
 or clock_timestamp()>=q.dispatch_until-interval '15 seconds'
 or (q.kind='expired' and clock_timestamp()>=e.disconnect_at-interval '168 hours') or (q.kind='disconnect_7d' and clock_timestamp()>=e.disconnect_at-interval '24 hours')
 or not exists(select 1 from auth.users u join public.company_members m on m.user_id=u.id and m.company_id=e.company_id and m.role='owner' and m.status='active' where u.id=q.recipient_user_id and lower(btrim(u.email))=q.recipient_email and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())) then
 update private.billing_expiry_email_outbox set state='cancelled' where id=q.id and state='claimed';return false;end if;
 update private.billing_expiry_email_outbox set state='dispatching' where id=q.id and claim_token=p_claim_token and state='claimed';return found;
end;$$;
-- A bounded dispatch gate serializes mail request initiation against VERIFIED renewal.
-- Payments are never sent again: the durable stored event is processed after this short gate.
do $$declare name text;backing text;signature regprocedure;definition text;begin
 foreach name in array array['billing_settle_live_paymob_hmac_verified','billing_settle_paymob_hmac_verified'] loop
  signature:=to_regprocedure('public.'||name||'(jsonb)');if signature is null then continue;end if;
  backing:=name||'_pre_expiry_mail';
  execute format('alter function public.%I(jsonb) set schema private',name);
  execute format('alter function private.%I(jsonb) rename to %I',name,backing);
  execute format('revoke all on function private.%I(jsonb) from public,anon,authenticated,service_role',backing);
  definition:=format($wrapper$create function public.%I(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $body$declare cid uuid;begin
   if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
   begin cid:=(p_evidence->>'company_id')::uuid;exception when invalid_text_representation then return private.%I(p_evidence);end;
   perform 1 from public.companies where id=cid for update;
   if exists(select 1 from private.billing_expiry_email_outbox q join private.billing_expiry_episodes e on e.id=q.episode_id where e.company_id=cid and q.state='dispatching' and q.dispatch_until>clock_timestamp()) then return jsonb_build_object('ok',false,'code','EMAIL_DISPATCH_IN_FLIGHT');end if;
   return private.%I(p_evidence);
  end;$body$;$wrapper$,name,backing,backing);execute definition;
  execute format('revoke all on function public.%I(jsonb) from public,anon,authenticated,service_role',name);
  execute format('grant execute on function public.%I(jsonb) to service_role',name);
 end loop;
end;$$;
create function public.billing_finish_expiry_email(p_id uuid,p_claim_token uuid,p_state text,p_provider_id text default null) returns boolean language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_state not in ('accepted','rejected','unknown') or (p_state='accepted')<>(p_provider_id is not null) then return false;end if;
 update private.billing_expiry_email_outbox set state=p_state,provider_id=p_provider_id where id=p_id and claim_token=p_claim_token and state='dispatching';return found;
end;$$;

revoke all on function private.billing_lifecycle_deadline(timestamptz,integer),private.billing_link_management_allowed(uuid),private.billing_history_account_allowed(uuid,text,text),private.billing_lifecycle_receipt(uuid),private.billing_chat_access(uuid,text),private.billing_chat_send(uuid),private.billing_cancel_old_expiry(uuid),private.billing_cancel_expiry_on_receipt(),private.billing_purge_chat(uuid),private.user_has_company_capability(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.billing_run_expiry_company(uuid),public.billing_expiry_candidates(integer),public.billing_read_lifecycle(uuid),public.billing_claim_expiry_email(),public.billing_authorize_expiry_email(uuid,uuid),public.billing_finish_expiry_email(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.billing_run_expiry_company(uuid),public.billing_expiry_candidates(integer),public.billing_claim_expiry_email(),public.billing_authorize_expiry_email(uuid,uuid),public.billing_finish_expiry_email(uuid,uuid,text,text) to service_role;
grant execute on function public.billing_read_lifecycle(uuid) to authenticated;
-- The helpers disclose only booleans; native scope/RLS still gates the underlying rows.
grant execute on function private.billing_chat_access(uuid,text),private.billing_history_account_allowed(uuid,text,text) to authenticated;
notify pgrst,'reload schema';commit;
