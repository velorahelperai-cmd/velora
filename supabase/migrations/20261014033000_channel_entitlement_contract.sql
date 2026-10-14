-- LOCAL CANDIDATE ONLY. No catalog/subscription seeds, publication or provider calls.
-- Commercial mappings require explicit approval before any deployment.
begin;
create table private.plan_channel_entitlements (
 plan_version_id uuid primary key references public.billing_plan_versions(id),
 channel_count integer not null check(channel_count in (1,2)),
 approval_reference text not null check(length(btrim(approval_reference))>0),
 approved_at timestamptz not null default clock_timestamp()
);
create table private.company_selected_channels (
 company_id uuid primary key references public.companies(id),
 plan_version_id uuid not null references public.billing_plan_versions(id),
 channels text[] not null check(channels in (array['whatsapp'],array['instagram'],array['whatsapp','instagram'])),
 revision bigint not null check(revision between 1 and 9007199254740991),
 selected_by uuid not null references auth.users(id),selected_at timestamptz not null default clock_timestamp()
);
create table private.company_channel_selection_events (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 actor_id uuid not null references auth.users(id),before_data jsonb,after_data jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table private.plan_channel_entitlements enable row level security;
alter table private.company_selected_channels enable row level security;
alter table private.company_channel_selection_events enable row level security;
revoke all on private.plan_channel_entitlements,private.company_selected_channels,private.company_channel_selection_events from public,anon,authenticated,service_role;

create function private.company_channel_contract(cid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare receipt jsonb;pv uuid;expires timestamptz;selection private.company_selected_channels%rowtype;slots integer;checked_at timestamptz;
begin
 receipt:=private.billing_lifecycle_receipt(cid);
 if receipt is not null then
  select s.plan_version_id into pv from public.billing_subscriptions s where s.id=(receipt->>'subscriptionId')::uuid and s.company_id=cid and s.environment='live';
  expires:=(receipt->>'expiredAt')::timestamptz;
 end if;
 select channel_count into slots from private.plan_channel_entitlements where plan_version_id=pv;
 select * into selection from private.company_selected_channels where company_id=cid;
 checked_at:=clock_timestamp();
 return jsonb_build_object('companyId',cid,'planVersionId',pv,
  'plan_entitlements',case when slots is null then jsonb_build_object('status','UNCONFIGURED') else jsonb_build_object('status','approved','channelCount',slots) end,
  'selected_channels',jsonb_build_object('planVersionId',selection.plan_version_id,'revision',coalesce(selection.revision,0),'channels',coalesce(to_jsonb(selection.channels),'[]'::jsonb)),
  'subscription',jsonb_build_object('state',case when expires is null then 'none' when checked_at<expires then 'active' when checked_at<expires+interval '720 hours' then 'grace' else 'locked' end,'expiresAt',expires));
end;$$;
create function private.channel_operation_allowed(cid uuid,ch text,op text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;selected jsonb;slots integer;
begin
 if ch is null or op is null or ch not in ('whatsapp','instagram') or op not in ('read','send','connect','automate') then return false;end if;
 c:=private.company_channel_contract(cid);selected:=c->'selected_channels'->'channels';
 if c->'plan_entitlements'->>'status'<>'approved' or c->>'planVersionId' is null
  or c->>'planVersionId' is distinct from c->'selected_channels'->>'planVersionId' then return false;end if;
 slots:=(c->'plan_entitlements'->>'channelCount')::integer;
 return jsonb_array_length(selected)=slots and selected?ch
  and (slots=1 or selected @> '["whatsapp","instagram"]'::jsonb)
  and (c->'subscription'->>'state'='active' or op='read' and c->'subscription'->>'state'='grace');
end;$$;
create function public.read_company_channel_contract(p_company_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.app_session_is_valid() or not exists(select 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and status='active') then raise insufficient_privilege;end if;
 return private.company_channel_contract(p_company_id);
end;$$;
-- Explicit owner action, serialized with native payment/expiry company locks.
-- Plan changes keep the previous selection and history until the owner confirms.
create function public.select_company_channels(p_company_id uuid,p_plan_version_id uuid,p_expected_revision bigint,p_channels text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb;old private.company_selected_channels%rowtype;slots integer;next_revision bigint;
begin
 if auth.uid() is null or not public.app_session_is_valid() or not exists(select 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and role='owner' and status='active') then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id and status<>'suspended' for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 c:=private.company_channel_contract(p_company_id);
 -- Waiting for payment/expiry or membership locks must not preserve an old owner
 -- decision or a request-start expiry timestamp.
 perform 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and role='owner' and status='active' for update;
 if not found then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid() for share;
 if not found or not public.app_session_is_valid() then raise insufficient_privilege;end if;
 c:=private.company_channel_contract(p_company_id);
 if c->'subscription'->>'expiresAt' is null or clock_timestamp()>=(c->'subscription'->>'expiresAt')::timestamptz then return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 if c->>'planVersionId' is distinct from p_plan_version_id::text then return jsonb_build_object('ok',false,'code','PLAN_CHANGED');end if;
 if c->'plan_entitlements'->>'status'<>'approved' then return jsonb_build_object('ok',false,'code','CHANNEL_DISTRIBUTION_UNDEFINED');end if;
 slots:=(c->'plan_entitlements'->>'channelCount')::integer;
 if p_channels is null or not (p_channels in (array['whatsapp'],array['instagram'],array['whatsapp','instagram'])) or cardinality(p_channels)<>slots then return jsonb_build_object('ok',false,'code','INVALID_SELECTION');end if;
 select * into old from private.company_selected_channels where company_id=p_company_id for update;
 if p_expected_revision is null or p_expected_revision<>coalesce(old.revision,0) or coalesce(old.revision,0)>=9007199254740991 then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if old.plan_version_id=p_plan_version_id and old.channels=p_channels then return jsonb_build_object('ok',true,'revision',old.revision);end if;
 next_revision:=coalesce(old.revision,0)+1;
 insert into private.company_selected_channels(company_id,plan_version_id,channels,revision,selected_by) values(p_company_id,p_plan_version_id,p_channels,next_revision,auth.uid())
 on conflict(company_id) do update set plan_version_id=excluded.plan_version_id,channels=excluded.channels,revision=excluded.revision,selected_by=excluded.selected_by,selected_at=clock_timestamp();
 insert into private.company_channel_selection_events(company_id,actor_id,before_data,after_data) values(p_company_id,auth.uid(),case when old.company_id is null then null else to_jsonb(old) end,jsonb_build_object('planVersionId',p_plan_version_id,'channels',p_channels,'revision',next_revision));
 return jsonb_build_object('ok',true,'revision',next_revision);
end;$$;
revoke all on function private.company_channel_contract(uuid),private.channel_operation_allowed(uuid,text,text),public.read_company_channel_contract(uuid),public.select_company_channels(uuid,uuid,bigint,text[]) from public,anon,authenticated,service_role;
grant execute on function public.read_company_channel_contract(uuid),public.select_company_channels(uuid,uuid,bigint,text[]) to authenticated;
-- Native channel operation boundaries must adopt channel_operation_allowed before
-- rollout. This foundation does not replace native role/connection/rollout checks.
notify pgrst,'reload schema';
commit;
