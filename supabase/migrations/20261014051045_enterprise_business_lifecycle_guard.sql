-- Compose customer operations with the independently installed business lifecycle.
-- Keep company/member history SELECT, platform authority and billing paths intact.
begin;
create function private.enterprise_business_operable(cid uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare business public.companies%rowtype;
begin
 select * into business from public.companies where id=cid for share nowait;
 if not found then return false;end if;
 return business.status<>'suspended'
 and nullif(to_jsonb(business)->>'archived_at','') is null
 and nullif(to_jsonb(business)->>'setup_file_destruction_at','') is null;
exception when lock_not_available then return false;
end; $$;

-- Copy bodies privately, then replace the original OIDs so callers and policies
-- receive the new guard. Original grants remain on the public entry points.
do $$ begin
 execute replace(pg_get_functiondef('private.enterprise_authorize(uuid)'::regprocedure),
  'FUNCTION private.enterprise_authorize(', 'FUNCTION private.enterprise_business_native_authorize(');
 execute replace(pg_get_functiondef('private.enterprise_can(uuid,uuid,uuid,text)'::regprocedure),
  'FUNCTION private.enterprise_can(', 'FUNCTION private.enterprise_business_native_can(');
 execute replace(pg_get_functiondef('public.enterprise_accept_invite(text)'::regprocedure),
  'FUNCTION public.enterprise_accept_invite(', 'FUNCTION private.enterprise_business_native_accept_invite(');
 execute replace(pg_get_functiondef('public.accept_staff_invitation(text)'::regprocedure),
  'FUNCTION public.accept_staff_invitation(', 'FUNCTION private.enterprise_business_native_accept_staff(');
end; $$;

create or replace function private.enterprise_authorize(cid uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.enterprise_business_operable(cid) then return null;end if;
 return private.enterprise_business_native_authorize(cid);
end; $$;
create or replace function private.enterprise_can(cid uuid,bid uuid,uid uuid,cap text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if not private.enterprise_business_operable(cid) then return false;end if;
 return private.enterprise_business_native_can(cid,bid,uid,cap);
end; $$;
create or replace function public.enterprise_accept_invite(p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare cid uuid;
begin
 select company_id into cid from private.staff_invitations where token_hash=p_token_hash;
 if cid is null or not private.enterprise_business_operable(cid) then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 return private.enterprise_business_native_accept_invite(p_token_hash);
end; $$;
create or replace function public.accept_staff_invitation(p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare cid uuid;
begin
 select company_id into cid from private.staff_invitations where token_hash=p_token_hash;
 if cid is null or not private.enterprise_business_operable(cid) then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 return private.enterprise_business_native_accept_staff(p_token_hash);
end; $$;

revoke all on function private.enterprise_business_operable(uuid),private.enterprise_business_native_authorize(uuid),
 private.enterprise_business_native_can(uuid,uuid,uuid,text),private.enterprise_business_native_accept_invite(text),
 private.enterprise_business_native_accept_staff(text) from public,anon,authenticated,service_role;
commit;
