-- Local draft lifecycle authority. No provider dispatch or external deletion.
begin;
alter table public.company_setup_drafts
 add column draft_id uuid not null default gen_random_uuid(),
 add column state text not null default 'active' check(state in ('active','completed','cancelled','deletion_pending','legacy_conflict')),
 add column generation bigint not null default 1 check(generation>0),
 add column last_meaningful_activity_at timestamptz,
 add column expires_at timestamptz,
 add column paid_protected_at timestamptz,
 add column paid_protection_receipt_id uuid,
 add column closed_at timestamptz,
 add column cleanup_policy text not null default 'UNCONFIGURED' check(cleanup_policy='UNCONFIGURED');
update public.company_setup_drafts set last_meaningful_activity_at=updated_at,expires_at=updated_at+interval '720 hours';
alter table public.company_setup_drafts alter column last_meaningful_activity_at set not null;
-- Preserve every legacy conflicting row. Only the owner can resolve the conflict.
update public.company_setup_drafts d set state='legacy_conflict' where user_id in
 (select user_id from public.company_setup_drafts group by user_id having count(*)>1);
alter table public.company_setup_drafts drop constraint company_setup_drafts_pkey;
alter table public.company_setup_drafts add primary key(draft_id);
create unique index master_one_active_setup_draft on public.company_setup_drafts(user_id) where state='active';
create index master_setup_draft_scope_history on public.company_setup_drafts(user_id,scope_id,updated_at desc);

create table private.master_setup_draft_outbox(
 id uuid primary key default gen_random_uuid(),draft_id uuid not null references public.company_setup_drafts(draft_id),
 generation bigint not null,kind text not null check(kind in ('free_14d','free_7d','free_24h','cleanup')),
 due_at timestamptz not null,state text not null check(state in ('queued','cancelled','blocked')),
 policy text not null default 'UNCONFIGURED' check(policy='UNCONFIGURED'),
 unique(draft_id,generation,kind)
);
create table private.master_setup_draft_confirmations(
 token uuid primary key default gen_random_uuid(),draft_id uuid not null references public.company_setup_drafts(draft_id),
 user_id uuid not null,session_id uuid not null,revision bigint not null,generation bigint not null,
 expires_at timestamptz not null,consumed_at timestamptz
);
alter table private.master_setup_draft_outbox enable row level security;
alter table private.master_setup_draft_confirmations enable row level security;
revoke all on private.master_setup_draft_outbox,private.master_setup_draft_confirmations from public,anon,authenticated,service_role;

create function private.master_setup_draft_session(p_user_id uuid) returns boolean
 language plpgsql volatile security definer set search_path='' as $$
declare n timestamptz:=clock_timestamp();sid uuid;begin
 if p_user_id is null or p_user_id is distinct from auth.uid() then return false;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
 if sid is null then return false;end if;
 -- VOLATILE gets current native row visibility on each post-lock invocation.
 -- The existing idle helper uses statement time; also enforce elapsed time now.
 return coalesce(public.app_session_is_valid(),false)
 and exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=sid and s.user_id=p_user_id and (s.not_after is null or s.not_after>n)
  and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=n))
 and case when (select enabled from private.app_session_settings where singleton) then
  exists(select 1 from private.app_session_activity a where a.session_id=sid and a.user_id=p_user_id
   and a.expired_at is null and a.last_activity_at<=n and a.last_activity_at>n-interval '2 hours')
 else true end;
end;$$;
create or replace function public.can_use_company_setup_draft(p_company_id uuid) returns boolean
 language sql volatile security definer set search_path='' as $$
 select private.master_setup_draft_session(auth.uid()) and case when p_company_id is null then
  exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=auth.uid() and m.role='owner' and m.status='active' and c.status<>'suspended')
  or (not public.is_platform_admin() and not exists(select 1 from public.company_members m where m.user_id=auth.uid() and m.status='active'))
 else exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id where m.user_id=auth.uid() and m.company_id=p_company_id and m.role='owner' and m.status='active' and c.status<>'suspended') end
$$;
-- Closed payloads remain inaccessible pending an approved legal destruction policy.
drop policy setup_draft_read on public.company_setup_drafts;
create policy setup_draft_read on public.company_setup_drafts for select to authenticated
 using(user_id=(select auth.uid()) and state in ('active','legacy_conflict') and public.can_use_company_setup_draft(company_id));

create function private.master_setup_draft_paid_receipt(cid uuid) returns uuid
 language sql stable security definer set search_path='' as $$
 select g.id from private.billing_proven_entitlement_grants g where g.company_id=cid
 and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id)
 order by g.applied_at desc,g.id desc limit 1
$$;
create function private.master_schedule_setup_draft(p_id uuid) returns void
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;begin
 select * into d from public.company_setup_drafts where draft_id=p_id;
 update private.master_setup_draft_outbox set state='cancelled' where draft_id=p_id and state='queued';
 if d.state='active' and d.paid_protected_at is null and d.expires_at is not null then
 insert into private.master_setup_draft_outbox(draft_id,generation,kind,due_at,state) values
 (d.draft_id,d.generation,'free_14d',d.expires_at-interval '336 hours','queued'),
 (d.draft_id,d.generation,'free_7d',d.expires_at-interval '168 hours','queued'),
 (d.draft_id,d.generation,'free_24h',d.expires_at-interval '24 hours','queued') on conflict do nothing;
 end if;
end;$$;
create function private.master_refresh_setup_paid(p_id uuid) returns void
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;receipt uuid;begin
 select * into d from public.company_setup_drafts where draft_id=p_id;
 if d.paid_protected_at is not null then return;end if;
 receipt:=private.master_setup_draft_paid_receipt(d.company_id);
 if receipt is null then return;end if;
 update public.company_setup_drafts set paid_protected_at=clock_timestamp(),paid_protection_receipt_id=receipt,
 expires_at=null,revision=revision+1,generation=generation+1,updated_at=clock_timestamp() where draft_id=p_id;
 perform private.master_schedule_setup_draft(p_id);
end;$$;
create function private.master_protect_setup_on_payment() returns trigger
 language plpgsql security definer set search_path='' as $$declare d record;begin
 -- Settlement already uses the canonical company lock. Never acquire the account lock here.
 perform 1 from public.companies where id=new.company_id for update;
 for d in select draft_id from public.company_setup_drafts where company_id=new.company_id and state in ('active','legacy_conflict','deletion_pending') loop
 perform private.master_refresh_setup_paid(d.draft_id);end loop;return new;
end;$$;
create constraint trigger master_protect_setup_on_payment after insert on public.billing_settlement_outcomes
 deferrable initially deferred for each row when(new.outcome='granted' and new.provider_environment='live')
 execute function private.master_protect_setup_on_payment();

-- Shared save implementation. Account -> company -> draft is the lock order.
create function private.master_save_setup_draft(p_expected_user_id uuid,p_company_id uuid,p_expected_revision bigint,
 p_payload jsonb,p_draft_id uuid,p_expected_generation bigint,p_begin boolean default false) returns jsonb
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;active public.company_setup_drafts;n timestamptz;begin
 if not coalesce(private.master_setup_draft_session(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not coalesce(public.can_use_company_setup_draft(p_company_id),false) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_expected_revision is null or p_expected_revision<0 or not private.valid_company_setup_payload(p_payload) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));
 if p_company_id is not null then perform 1 from public.companies where id=p_company_id for update;end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not public.can_use_company_setup_draft(p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if exists(select 1 from public.company_setup_drafts where user_id=p_expected_user_id and state='legacy_conflict') then return jsonb_build_object('ok',false,'code','LEGACY_DRAFT_CONFLICT');end if;
 if p_draft_id is not null then
 select * into d from public.company_setup_drafts where draft_id=p_draft_id for update;
 if d.draft_id is not null and (d.user_id<>p_expected_user_id or d.company_id is distinct from p_company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 else
 select * into d from public.company_setup_drafts where user_id=p_expected_user_id and company_id is not distinct from p_company_id order by updated_at desc,draft_id desc limit 1 for update;
 end if;
 if d.draft_id is not null and d.state<>'active' then return jsonb_build_object('ok',false,'code','DRAFT_CLOSED');end if;
 select * into active from public.company_setup_drafts where user_id=p_expected_user_id and state='active';
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if active.draft_id is not null and (d.draft_id is null or d.draft_id<>active.draft_id) then return jsonb_build_object('ok',false,'code','ACTIVE_DRAFT_EXISTS');end if;
 if d.draft_id is not null then
 perform private.master_refresh_setup_paid(d.draft_id);select * into d from public.company_setup_drafts where draft_id=d.draft_id;
 n:=clock_timestamp();
 if d.paid_protected_at is null and n>=d.expires_at then return jsonb_build_object('ok',false,'code','DRAFT_EXPIRED');end if;
 if p_draft_id is null and exists(select 1 from public.company_setup_drafts h where h.user_id=p_expected_user_id and h.company_id is not distinct from p_company_id and h.state not in ('active','legacy_conflict')) then return jsonb_build_object('ok',false,'code','DRAFT_BINDING_REQUIRED');end if;
 -- Lost-response retry is permitted only for the same active generation.
 if d.payload=p_payload and (p_expected_generation is null or p_expected_generation=d.generation or (p_expected_generation=d.generation-1 and p_expected_revision=d.revision-1)) then return jsonb_build_object('ok',true,'data',to_jsonb(d));end if;
 if p_expected_generation is not null and p_expected_generation<>d.generation then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_expected_revision<>d.revision then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 update public.company_setup_drafts set payload=p_payload,revision=revision+1,generation=generation+1,
 last_meaningful_activity_at=n,updated_at=n,
 expires_at=case when paid_protected_at is null then n+interval '720 hours' else null end where draft_id=d.draft_id returning * into d;
 else
 if p_expected_revision<>0 or (p_draft_id is not null and not p_begin) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if not p_begin and exists(select 1 from public.company_setup_drafts where user_id=p_expected_user_id and company_id is not distinct from p_company_id) then return jsonb_build_object('ok',false,'code','DRAFT_CLOSED');end if;
 n:=clock_timestamp();
 insert into public.company_setup_drafts(draft_id,user_id,company_id,payload,last_meaningful_activity_at,expires_at,updated_at)
 values(coalesce(p_draft_id,gen_random_uuid()),p_expected_user_id,p_company_id,p_payload,n,n+interval '720 hours',n) returning * into d;
 perform private.master_refresh_setup_paid(d.draft_id);select * into d from public.company_setup_drafts where draft_id=d.draft_id;
 end if;
 perform private.master_schedule_setup_draft(d.draft_id);
 return jsonb_build_object('ok',true,'data',to_jsonb(d));
end;$$;
create or replace function public.save_company_setup_draft(p_expected_user_id uuid,p_company_id uuid,p_expected_revision bigint,p_payload jsonb)
 returns jsonb language sql security definer set search_path='' as $$select private.master_save_setup_draft(p_expected_user_id,p_company_id,p_expected_revision,p_payload,null,null,false)$$;
create function public.master_save_company_setup_draft(p_expected_user_id uuid,p_company_id uuid,p_expected_revision bigint,p_payload jsonb,p_draft_id uuid,p_expected_generation bigint)
 returns jsonb language sql security definer set search_path='' as $$select case when p_draft_id is null or p_expected_generation is null or p_expected_generation<1 then jsonb_build_object('ok',false,'code','INVALID_INPUT') else private.master_save_setup_draft(p_expected_user_id,p_company_id,p_expected_revision,p_payload,p_draft_id,p_expected_generation,false) end$$;
create function public.begin_company_setup_draft(p_expected_user_id uuid,p_company_id uuid,p_attempt_id uuid,p_payload jsonb)
 returns jsonb language sql security definer set search_path='' as $$select case when p_attempt_id is null then jsonb_build_object('ok',false,'code','INVALID_INPUT') else private.master_save_setup_draft(p_expected_user_id,p_company_id,0,p_payload,p_attempt_id,null,true) end$$;
create function public.read_active_company_setup_draft(p_expected_user_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;begin
 if not coalesce(private.master_setup_draft_session(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if exists(select 1 from public.company_setup_drafts where user_id=p_expected_user_id and state='legacy_conflict') then return jsonb_build_object('ok',false,'code','LEGACY_DRAFT_CONFLICT');end if;
 select * into d from public.company_setup_drafts where user_id=p_expected_user_id and state='active';
 if d.draft_id is null then return jsonb_build_object('ok',true,'data',null);end if;
 if not public.can_use_company_setup_draft(d.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if d.company_id is not null then perform 1 from public.companies where id=d.company_id for update;end if;
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not public.can_use_company_setup_draft(d.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform private.master_refresh_setup_paid(d.draft_id);select * into d from public.company_setup_drafts where draft_id=d.draft_id;
 return jsonb_build_object('ok',true,'data',to_jsonb(d));
end;$$;
create function public.master_setup_draft_action(p_expected_user_id uuid,p_draft_id uuid,p_expected_revision bigint,p_expected_generation bigint,p_action text,p_confirmation_token uuid default null) returns jsonb
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;token uuid;n timestamptz;begin
 if not coalesce(private.master_setup_draft_session(p_expected_user_id),false) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if p_action is null or p_action not in ('keep','complete','preview_cancel','confirm_cancel') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_expected_user_id::text||':setup-draft',0));
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into d from public.company_setup_drafts where draft_id=p_draft_id and user_id=p_expected_user_id;
 if d.draft_id is null or not public.can_use_company_setup_draft(d.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if d.company_id is not null then perform 1 from public.companies where id=d.company_id for update;end if;
 perform private.master_refresh_setup_paid(d.draft_id);select * into d from public.company_setup_drafts where draft_id=p_draft_id for update;n:=clock_timestamp();
 if not private.master_setup_draft_session(p_expected_user_id) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not public.can_use_company_setup_draft(d.company_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if d.state not in ('active','legacy_conflict') then return jsonb_build_object('ok',false,'code','DRAFT_CLOSED');end if;
 if p_expected_revision is distinct from d.revision or p_expected_generation is distinct from d.generation then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_action in ('keep','complete') and d.paid_protected_at is null and n>=d.expires_at then return jsonb_build_object('ok',false,'code','DRAFT_EXPIRED');end if;
 if p_action='preview_cancel' then
 insert into private.master_setup_draft_confirmations(draft_id,user_id,session_id,revision,generation,expires_at) values(d.draft_id,p_expected_user_id,(auth.jwt()->>'session_id')::uuid,d.revision,d.generation,n+interval '5 minutes') returning master_setup_draft_confirmations.token into token;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('confirmationToken',token,'scopedFileCount',0,'unscopedFilesIncluded',false,'cleanupPolicy','UNCONFIGURED','scope','draft_payload_only','companyPreserved',true));
 elsif p_action='confirm_cancel' then
 update private.master_setup_draft_confirmations c set consumed_at=n where c.token=p_confirmation_token and c.draft_id=d.draft_id and c.user_id=p_expected_user_id and c.session_id::text=auth.jwt()->>'session_id' and c.revision=d.revision and c.generation=d.generation and c.consumed_at is null and c.expires_at>n;
 if not found then return jsonb_build_object('ok',false,'code','CONFIRMATION_REQUIRED');end if;
 update public.company_setup_drafts set state='cancelled',closed_at=n,revision=revision+1,generation=generation+1,updated_at=n where draft_id=d.draft_id returning * into d;
 elsif p_action='complete' then
 -- Completion releases the setup lock; it grants no AI/channel readiness or payment.
 if d.company_id is null then return jsonb_build_object('ok',false,'code','COMPANY_REQUIRED');end if;
 update public.company_setup_drafts set state='completed',closed_at=n,revision=revision+1,generation=generation+1,updated_at=n where draft_id=d.draft_id returning * into d;
 else
 if d.state='legacy_conflict' and exists(select 1 from public.company_setup_drafts where user_id=p_expected_user_id and draft_id<>d.draft_id and state in ('active','legacy_conflict')) then return jsonb_build_object('ok',false,'code','LEGACY_DRAFT_CONFLICT');end if;
 update public.company_setup_drafts set state='active',last_meaningful_activity_at=n,expires_at=case when paid_protected_at is null then n+interval '720 hours' else null end,revision=revision+1,generation=generation+1,updated_at=n where draft_id=d.draft_id returning * into d;
 end if;
 perform private.master_schedule_setup_draft(d.draft_id);
 if p_action='confirm_cancel' then insert into private.master_setup_draft_outbox(draft_id,generation,kind,due_at,state) values(d.draft_id,d.generation,'cleanup',n,'blocked') on conflict do nothing;end if;
 return jsonb_build_object('ok',true,'data',to_jsonb(d)-'payload');
end;$$;
-- Explicit local worker entry point; neither legal destruction nor notices are executable.
create function public.master_expire_setup_draft(p_draft_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;n timestamptz;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into d from public.company_setup_drafts where draft_id=p_draft_id;if d.draft_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 perform pg_advisory_xact_lock(hashtextextended(d.user_id::text||':setup-draft',0));
 if d.company_id is not null then perform 1 from public.companies where id=d.company_id for update;end if;
 perform private.master_refresh_setup_paid(d.draft_id);select * into d from public.company_setup_drafts where draft_id=p_draft_id for update;n:=clock_timestamp();
 if d.state<>'active' then return jsonb_build_object('ok',true,'code','DRAFT_CLOSED');end if;
 if d.paid_protected_at is not null then return jsonb_build_object('ok',true,'code','PAID_PROTECTED');end if;
 if n<d.expires_at then return jsonb_build_object('ok',true,'code','NOT_DUE');end if;
 update public.company_setup_drafts set state='deletion_pending',closed_at=n,revision=revision+1,generation=generation+1,updated_at=n where draft_id=d.draft_id returning * into d;
 perform private.master_schedule_setup_draft(d.draft_id);
 insert into private.master_setup_draft_outbox(draft_id,generation,kind,due_at,state) values(d.draft_id,d.generation,'cleanup',n,'blocked') on conflict do nothing;
 return jsonb_build_object('ok',true,'code','EXPIRED_DELETION_BLOCKED','cleanupPolicy','UNCONFIGURED');
end;$$;
create or replace function private.attach_company_setup_draft() returns trigger
 language plpgsql security definer set search_path='' as $$declare d public.company_setup_drafts;begin
 if new.role='owner' and new.status='active' and exists(select 1 from public.companies c where c.id=new.company_id and c.created_by=new.user_id) then
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text||':setup-draft',0));
 update public.company_setup_drafts set company_id=new.company_id,revision=revision+1,updated_at=clock_timestamp() where user_id=new.user_id and company_id is null and state='active' returning * into d;
 if d.draft_id is not null then perform private.master_refresh_setup_paid(d.draft_id);end if;
 end if;return new;
end;$$;
do $$declare d record;begin for d in select draft_id from public.company_setup_drafts loop perform private.master_refresh_setup_paid(d.draft_id);perform private.master_schedule_setup_draft(d.draft_id);end loop;end;$$;
revoke all on function private.master_setup_draft_session(uuid),private.master_setup_draft_paid_receipt(uuid),private.master_schedule_setup_draft(uuid),private.master_refresh_setup_paid(uuid),private.master_protect_setup_on_payment(),private.master_save_setup_draft(uuid,uuid,bigint,jsonb,uuid,bigint,boolean) from public,anon,authenticated,service_role;
revoke all on function public.master_save_company_setup_draft(uuid,uuid,bigint,jsonb,uuid,bigint),public.begin_company_setup_draft(uuid,uuid,uuid,jsonb),public.read_active_company_setup_draft(uuid),public.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid),public.master_expire_setup_draft(uuid) from public,anon,authenticated,service_role;
grant execute on function public.master_save_company_setup_draft(uuid,uuid,bigint,jsonb,uuid,bigint),public.begin_company_setup_draft(uuid,uuid,uuid,jsonb),public.read_active_company_setup_draft(uuid),public.master_setup_draft_action(uuid,uuid,bigint,bigint,text,uuid) to authenticated;
grant execute on function public.master_expire_setup_draft(uuid) to service_role;
notify pgrst,'reload schema';
commit;
