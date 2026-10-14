-- Smart setup only. No existing staff, company RLS, channel routing or session
-- policy mutation. Native Auth and idle authority remain canonical.
begin;
set local lock_timeout='3s';
create table public.company_branches(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 name text not null check(char_length(btrim(name)) between 1 and 120),timezone text not null default 'UTC',
 status text not null default 'setup' check(status in ('setup','active','suspended')),
 is_primary boolean not null default false,created_at timestamptz not null default clock_timestamp(),unique(company_id,id)
);
create unique index company_branches_primary on public.company_branches(company_id) where is_primary;
insert into public.company_branches(company_id,name,is_primary,status) select id,display_name,true,'active' from public.companies;
create table private.smart_branch_setup(
 company_id uuid primary key references public.companies(id),mode text not null check(mode in ('single','multiple')),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id)
);
create table private.smart_branch_audit(
 id bigint generated always as identity primary key,company_id uuid not null references public.companies(id),
 branch_id uuid,actor_id uuid not null references auth.users(id),action text not null,detail jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
alter table public.company_branches enable row level security;
alter table private.smart_branch_setup enable row level security;
alter table private.smart_branch_audit enable row level security;
-- Bounded owner RPC projections only; no raw table exposure or broad permissions.
revoke all on public.company_branches,private.smart_branch_setup,private.smart_branch_audit from public,anon,authenticated,service_role;
revoke all on sequence private.smart_branch_audit_id_seq from public,anon,authenticated,service_role;
create function private.smart_setup_actor() returns uuid language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;s auth.sessions%rowtype;
begin
 if uid is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return null;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return null;end;
 select * into s from auth.sessions where id=sid and user_id=uid for share nowait;
 if not found or coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')<=clock_timestamp()
 or coalesce((auth.jwt()->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) then return null;end if;
 if (public.check_app_session(false)->>'ok') is distinct from 'true' or not public.app_session_is_valid() then return null;end if;
 perform 1 from auth.users u where u.id=uid and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
 and nullif(to_jsonb(u)->>'deleted_at','') is null
 and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=clock_timestamp() for share nowait;
 if not found then return null;end if;
 return uid;
exception when lock_not_available then return null;
end;$$;
create function private.smart_setup_owner(cid uuid,uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=cid and m.user_id=uid and m.role='owner' and m.status='active' and c.status<>'suspended'
 and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null)
$$;
create function private.smart_setup_authorize(cid uuid) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_actor();
begin
 if uid is null then return null;end if;
 perform 1 from public.companies c where c.id=cid and c.status<>'suspended' and nullif(to_jsonb(c)->>'archived_at','') is null and nullif(to_jsonb(c)->>'setup_file_destruction_at','') is null for share nowait;
 if not found then return null;end if;
 perform 1 from public.company_members where company_id=cid and user_id=uid and role='owner' and status='active' for share nowait;
 if not found then return null;end if;
 return uid;
exception when lock_not_available then return null;
end;$$;
create function private.smart_setup_commit(cid uuid,uid uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin if private.smart_setup_authorize(cid) is distinct from uid then raise exception 'AUTHORITY_CHANGED' using errcode='42501';end if;end;$$;
create function private.smart_new_company_branch() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.company_branches(company_id,name,is_primary,status) values(new.id,new.display_name,true,'active');return new;end;$$;
create trigger smart_primary_branch after insert on public.companies for each row execute function private.smart_new_company_branch();
create function private.smart_branch_setup_receipt(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare prefs private.smart_branch_setup%rowtype;branches jsonb;
begin
 select * into prefs from private.smart_branch_setup where company_id=p_company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'primary',b.is_primary,'status',b.status) order by b.created_at,b.id),'[]'::jsonb)
 into branches from public.company_branches b where b.company_id=p_company_id;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('companyId',p_company_id,'revision',coalesce(prefs.revision,0),'mode',prefs.mode,'branches',branches));
end;$$;
create function public.read_smart_branch_setup(p_company_id uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.smart_setup_authorize(p_company_id);
begin if uid is null or not private.smart_setup_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;return private.smart_branch_setup_receipt(p_company_id);end;$$;
revoke all on function private.smart_setup_actor(),private.smart_setup_owner(uuid,uuid),private.smart_setup_authorize(uuid),private.smart_setup_commit(uuid,uuid),private.smart_new_company_branch(),private.smart_branch_setup_receipt(uuid),public.read_smart_branch_setup(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_smart_branch_setup(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
