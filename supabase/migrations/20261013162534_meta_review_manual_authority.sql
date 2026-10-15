begin;
create table private.channel_review_grants(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 owner_id uuid not null references auth.users(id),channel text not null check(channel in ('whatsapp','instagram')),
 app_id text not null check(app_id ~ '^[0-9]{1,64}$'),asset_id text not null check(asset_id ~ '^[0-9]{1,64}$'),
 source_account_id text not null check(source_account_id ~ '^[0-9]{1,64}$'),recipient_ids text[] not null,
 webhook_secret_sha256 text not null check(webhook_secret_sha256 ~ '^[0-9a-f]{64}$'),
 send_limit int not null default 50 check(send_limit=50),used_count int not null default 0 check(used_count between 0 and 50),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,revoked_at timestamptz,
 check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '7 days'),
 check(cardinality(recipient_ids) between 1 and 5)
);
create unique index channel_review_one_grant on private.channel_review_grants(company_id,channel) where revoked_at is null;
create table private.channel_review_uses(
 channel text not null check(channel in ('whatsapp','instagram')),intent_id uuid not null,
 grant_id uuid not null references private.channel_review_grants(id),claim_receipt uuid not null,
 created_at timestamptz not null default clock_timestamp(),primary key(channel,intent_id)
);
alter table private.channel_review_grants enable row level security;
alter table private.channel_review_uses enable row level security;
revoke all on private.channel_review_grants,private.channel_review_uses from public,anon,authenticated,service_role;

create function private.channel_review_public(g private.channel_review_grants) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('id',g.id,'channel',g.channel,
 'app_id',g.app_id,'asset_id',g.asset_id,'source_account_id',g.source_account_id,'recipient_ids',g.recipient_ids,
 'send_limit',g.send_limit,'used_count',g.used_count,'expires_at',g.expires_at,'revoked_at',g.revoked_at)$$;

create function public.admin_grant_channel_review(p_company_id uuid,p_channel text,p_app_id text,p_asset_id text,
 p_source_account_id text,p_recipient_ids text[],p_webhook_secret_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;owner_uid uuid;g private.channel_review_grants%rowtype;started timestamptz;begin
 if current_setting('role',true) is distinct from 'authenticated' or (public.check_app_session(false)->>'ok') is distinct from 'true' then raise insufficient_privilege;end if;
 actor:=private.require_platform_admin();
 if not private.can_admin_company(p_company_id,'platform.manage_companies') then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id and status='active' for share nowait;if not found then raise insufficient_privilege;end if;
 if (select count(*) from public.company_members where company_id=p_company_id and role='owner' and status='active')<>1 then raise insufficient_privilege;end if;
 select user_id into owner_uid from public.company_members where company_id=p_company_id and role='owner' and status='active' for share nowait;
 if p_channel is null or p_channel not in ('whatsapp','instagram') or p_app_id is null or p_app_id !~ '^[0-9]{1,64}$'
 or p_asset_id is null or p_asset_id !~ '^[0-9]{1,64}$' or p_source_account_id is null or p_source_account_id !~ '^[0-9]{1,64}$'
 or p_webhook_secret_sha256 is null or p_webhook_secret_sha256 !~ '^[0-9a-f]{64}$'
 or p_recipient_ids is null or cardinality(p_recipient_ids) not between 1 and 5
 or exists(select 1 from unnest(p_recipient_ids) x where x is null or x !~ '^[1-9][0-9]{1,63}$')
 or cardinality(p_recipient_ids)<>(select count(distinct x) from unnest(p_recipient_ids) x)
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into g from private.channel_review_grants where company_id=p_company_id and channel=p_channel and revoked_at is null for update nowait;
 if found then
  if (g.owner_id,g.app_id,g.asset_id,g.source_account_id,g.recipient_ids,g.webhook_secret_sha256)
   is distinct from (owner_uid,p_app_id,p_asset_id,p_source_account_id,p_recipient_ids,p_webhook_secret_sha256)
   then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  return jsonb_build_object('ok',true,'grant',private.channel_review_public(g));
 end if;
 started:=clock_timestamp();
 insert into private.channel_review_grants(company_id,owner_id,channel,app_id,asset_id,source_account_id,recipient_ids,
 webhook_secret_sha256,created_by,created_at,expires_at)
 values(p_company_id,owner_uid,p_channel,p_app_id,p_asset_id,p_source_account_id,p_recipient_ids,p_webhook_secret_sha256,actor,started,started+interval '7 days') returning * into g;
 perform private.write_admin_audit(actor,p_company_id,'channel_review.granted',null,private.channel_review_public(g));
 return jsonb_build_object('ok',true,'grant',private.channel_review_public(g));
exception when unique_violation or lock_not_available then return jsonb_build_object('ok',false,'code','CONFLICT');end;$$;

create function public.admin_revoke_channel_review(p_grant_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare actor uuid;g private.channel_review_grants%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' or (public.check_app_session(false)->>'ok') is distinct from 'true' then raise insufficient_privilege;end if;
 actor:=private.require_platform_admin();
 select * into g from private.channel_review_grants where id=p_grant_id for update nowait;
 if not found or not private.can_admin_company(g.company_id,'platform.manage_companies') then raise insufficient_privilege;end if;
 if g.revoked_at is null then
  update private.channel_review_grants set revoked_at=clock_timestamp() where id=g.id returning * into g;
  perform private.write_admin_audit(actor,g.company_id,'channel_review.revoked',null,private.channel_review_public(g));
 end if;return jsonb_build_object('ok',true,'grant',private.channel_review_public(g));end;$$;

create function public.read_channel_review_access(p_company_id uuid,p_channel text) returns jsonb
language plpgsql security definer set search_path='' as $$declare g private.channel_review_grants%rowtype;begin
 if current_setting('role',true) is distinct from 'authenticated' or (public.check_app_session(false)->>'ok') is distinct from 'true'
 or not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=p_company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active' and c.status='active')
 then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into g from private.channel_review_grants where company_id=p_company_id and owner_id=auth.uid() and channel=p_channel
 and revoked_at is null and expires_at>clock_timestamp() and used_count<send_limit;
 if not found then return jsonb_build_object('ok',false,'code','REVIEW_UNAVAILABLE');end if;
 return jsonb_build_object('ok',true,'grant',private.channel_review_public(g));end;$$;

create function private.reserve_channel_review(p_grant_id uuid,p_company_id uuid,p_owner_id uuid,p_channel text,
 p_asset_id text,p_recipient_id text,p_intent_id uuid,p_claim_receipt uuid) returns jsonb
language plpgsql volatile set search_path='' as $$declare g private.channel_review_grants%rowtype;u private.channel_review_uses%rowtype;begin
 select * into g from private.channel_review_grants where id=p_grant_id for update nowait;
 if not found or (g.company_id,g.owner_id,g.channel,g.asset_id) is distinct from (p_company_id,p_owner_id,p_channel,p_asset_id)
 or p_recipient_id is null or not p_recipient_id=any(g.recipient_ids) or p_intent_id is null or p_claim_receipt is null
 or g.revoked_at is not null or g.expires_at<=clock_timestamp()
 or not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=g.company_id and m.user_id=g.owner_id and m.role='owner' and m.status='active' and c.status='active')
 then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
 select * into u from private.channel_review_uses where channel=p_channel and intent_id=p_intent_id;
 if found then
  if u.grant_id is distinct from g.id or u.claim_receipt is distinct from p_claim_receipt then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
 else
  if g.used_count>=g.send_limit then raise exception 'REVIEW_DENIED' using errcode='PRV01';end if;
  insert into private.channel_review_uses(channel,intent_id,grant_id,claim_receipt) values(p_channel,p_intent_id,g.id,p_claim_receipt);
  update private.channel_review_grants set used_count=used_count+1 where id=g.id returning * into g;
 end if;
 return jsonb_build_object('grant_id',g.id,'company_id',g.company_id,'channel',g.channel,'asset_id',g.asset_id,'expires_at',g.expires_at);
end;$$;

revoke all on function private.channel_review_public(private.channel_review_grants),private.reserve_channel_review(uuid,uuid,uuid,text,text,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_grant_channel_review(uuid,text,text,text,text,text[],text),public.admin_revoke_channel_review(uuid),public.read_channel_review_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_grant_channel_review(uuid,text,text,text,text,text[],text),public.admin_revoke_channel_review(uuid),public.read_channel_review_access(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
