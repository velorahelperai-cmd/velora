-- Requires enterprise_branch_authority. Preparation only; no channel/payment mutation.
begin;
set local lock_timeout='3s';
create table private.smart_branch_setup (
 company_id uuid primary key references public.companies(id),
 mode text not null check(mode in ('single','multiple')),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid not null references auth.users(id)
);
alter table private.smart_branch_setup enable row level security;
revoke all on private.smart_branch_setup from public,anon,authenticated,service_role;

create function private.smart_branch_setup_receipt(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prefs private.smart_branch_setup%rowtype;branches jsonb;
begin
 select * into prefs from private.smart_branch_setup where company_id=p_company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'primary',b.is_primary,'status',b.status) order by b.created_at,b.id),'[]'::jsonb)
 into branches from public.company_branches b where b.company_id=p_company_id;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('companyId',p_company_id,'revision',coalesce(prefs.revision,0),'mode',prefs.mode,'branches',branches));
end;$$;
revoke all on function private.smart_branch_setup_receipt(uuid) from public,anon,authenticated,service_role;

create function public.read_smart_branch_setup(p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);
begin
 if uid is null or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 return private.smart_branch_setup_receipt(p_company_id);
end;$$;

create function public.save_smart_branch_setup(p_company_id uuid,p_expected_revision integer,p_mode text,p_primary_name text,p_expected_primary_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);prefs private.smart_branch_setup%rowtype;primary_id uuid;primary_name text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
 if not found or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=p_company_id and status<>'suspended' for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_expected_revision is null or p_expected_revision<0 or p_mode is null or p_mode not in ('single','multiple')
 or p_primary_name is null or char_length(btrim(p_primary_name)) not between 1 and 120 or p_primary_name~'[[:cntrl:]]'
 or p_expected_primary_name is null or char_length(btrim(p_expected_primary_name)) not between 1 and 120 or p_expected_primary_name~'[[:cntrl:]]' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into prefs from private.smart_branch_setup where company_id=p_company_id for update;
 -- Replaying exactly the committed choice is idempotent, including a lost response.
 if found and prefs.revision=p_expected_revision+1 and prefs.mode=p_mode
 and exists(select 1 from public.company_branches where company_id=p_company_id and is_primary and name=btrim(p_primary_name)) then return public.read_smart_branch_setup(p_company_id);end if;
 if coalesce(prefs.revision,0)<>p_expected_revision then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if p_mode='single' and (select count(*) from public.company_branches where company_id=p_company_id and status='active')>1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select id,name into primary_id,primary_name from public.company_branches where company_id=p_company_id and is_primary and status='active' for update;
 if not found then return jsonb_build_object('ok',false,'code','UNCONFIGURED');end if;
 if primary_name is distinct from p_expected_primary_name then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 -- All locks are held. Expiry during a lock wait cannot grant write authority.
 if private.enterprise_authorize(p_company_id) is distinct from uid then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 update public.company_branches set name=btrim(p_primary_name) where id=primary_id;
 insert into private.smart_branch_setup(company_id,mode,updated_by) values(p_company_id,p_mode,uid)
 on conflict(company_id) do update set mode=excluded.mode,revision=smart_branch_setup.revision+1,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 insert into public.company_branch_audit(company_id,branch_id,actor_id,action,detail) values(p_company_id,primary_id,uid,'onboarding.branches.confirmed',jsonb_build_object('mode',p_mode));
 perform private.enterprise_commit(p_company_id,uid);
 return private.smart_branch_setup_receipt(p_company_id);
end;$$;
revoke all on function public.read_smart_branch_setup(uuid),public.save_smart_branch_setup(uuid,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.read_smart_branch_setup(uuid),public.save_smart_branch_setup(uuid,integer,text,text,text) to authenticated;
commit;
