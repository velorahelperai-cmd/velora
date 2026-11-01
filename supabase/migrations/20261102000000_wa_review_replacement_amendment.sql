-- Operator-recorded owner change of replacement target; original receipt stays immutable.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table private.wa_review_replacement_amendments(
 review_id uuid primary key references private.wa_checkpoint_review_requests(id) on delete restrict,
 phone_number_id text not null check(phone_number_id ~ '^[0-9]{1,64}$'),
 phone_hash text not null check(phone_hash ~ '^[a-f0-9]{64}$'),
 decision_ref text not null check(decision_ref ~ '^[A-Z0-9_-]{8,100}$'),
 recorded_at timestamptz not null default clock_timestamp(),
 recorded_by text not null default current_user check(recorded_by='postgres')
);
alter table private.wa_review_replacement_amendments enable row level security;
alter table private.wa_review_replacement_amendments owner to postgres;
revoke all on private.wa_review_replacement_amendments from public,anon,authenticated,service_role;
create function private.wa_review_preserve_amendment() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'WA_REVIEW_AMENDMENT_PRESERVED' using errcode='23514';end $$;
alter function private.wa_review_preserve_amendment() owner to postgres;
revoke all on function private.wa_review_preserve_amendment() from public,anon,authenticated,service_role;
create trigger wa_review_preserve_amendment before update or delete on private.wa_review_replacement_amendments
 for each row execute function private.wa_review_preserve_amendment();

create function private.wa_amend_review_to_new_number(p_review uuid,p_owner uuid,p_company uuid,p_branch uuid,p_old_phone text,p_new_phone text,p_phone_id text,p_decision text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.wa_checkpoint_review_requests%rowtype; m private.wa_review_replacement_amendments%rowtype; binding jsonb;
begin
 if current_user<>'postgres' then raise exception 'OPERATOR_ROLE_REQUIRED' using errcode='42501';end if;
 if p_old_phone is null or p_new_phone is null or p_old_phone !~ '^[+][1-9][0-9]{6,14}$' or p_new_phone !~ '^[+][1-9][0-9]{6,14}$'
 or p_old_phone=p_new_phone or p_phone_id is null or p_phone_id !~ '^[0-9]{1,64}$' or p_decision is null or p_decision !~ '^[A-Z0-9_-]{8,100}$' then
 return jsonb_build_object('ok',false,'code','invalid_input');end if;
 perform pg_catalog.pg_advisory_xact_lock(87420303,pg_catalog.hashtext(p_company::text||':whatsapp'));
 select * into r from private.wa_checkpoint_review_requests where id=p_review for update;
 if r.id is null or r.status<>'closed_preserved' or r.account_id is distinct from p_owner or r.company_id is distinct from p_company or r.branch_id is distinct from p_branch
 or r.replacement_phone_hash is distinct from encode(sha256(convert_to(p_old_phone,'UTF8')),'hex') then
 return jsonb_build_object('ok',false,'code','scope_mismatch');end if;
 if r.id is distinct from (select x.id from private.wa_checkpoint_review_requests x where x.company_id=p_company and x.branch_id=p_branch and x.status='closed_preserved' order by x.resolved_at desc,x.id desc limit 1) then
 return jsonb_build_object('ok',false,'code','stale_review');end if;
 binding:=private.es02_b3_current_binding(p_owner,p_company,p_branch,'whatsapp');
 if binding->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','binding_changed');end if;
 select * into m from private.wa_review_replacement_amendments where review_id=r.id;
 if m.review_id is not null then
  return jsonb_build_object('ok',m.phone_number_id=p_phone_id and m.phone_hash=encode(sha256(convert_to(p_new_phone,'UTF8')),'hex') and m.decision_ref=p_decision,'code','already_recorded');end if;
 if private.wa_review_replacement_fulfilled(r.id) then return jsonb_build_object('ok',false,'code','already_fulfilled');end if;
 if exists(select 1 from private.es02_b3_connection_attempts where company_id=p_company and channel='whatsapp' and status in ('pending','claimed','vault_staged','unknown','bound'))
 or exists(select 1 from private.es02_b3_connection_links where company_id=p_company and channel='whatsapp' and revoked_at is null)
 or exists(select 1 from public.whatsapp_company_links where company_id=p_company)
 or exists(select 1 from private.whatsapp_coexistence_connections where company_id=p_company)
 or exists(select 1 from private.whatsapp_coexistence_signup_attempts where company_id=p_company and status in ('started','claimed','token_checkpointed','reconcile_required')) then
 return jsonb_build_object('ok',false,'code','connection_or_work_present');end if;
 insert into private.wa_review_replacement_amendments(review_id,phone_number_id,phone_hash,decision_ref)
 values(r.id,p_phone_id,encode(sha256(convert_to(p_new_phone,'UTF8')),'hex'),p_decision);
 return jsonb_build_object('ok',true,'code','recorded');
end $$;
alter function private.wa_amend_review_to_new_number(uuid,uuid,uuid,uuid,text,text,text,text) owner to postgres;
revoke all on function private.wa_amend_review_to_new_number(uuid,uuid,uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;

-- Pin the approved Meta phone ID before a new-number token can be checkpointed.
create function private.wa_review_check_new_number() returns trigger
language plpgsql security definer set search_path='' as $$
declare a private.es02_b3_connection_attempts%rowtype; r private.wa_checkpoint_review_requests%rowtype; m private.wa_review_replacement_amendments%rowtype;
begin
 select * into a from private.es02_b3_connection_attempts where id=new.attempt_id;
 select * into r from private.wa_checkpoint_review_requests where company_id=a.company_id and branch_id=a.branch_id and status='closed_preserved' order by resolved_at desc,id desc limit 1;
 if r.id is null or new.attempt_id=r.attempt_id or private.wa_review_replacement_fulfilled(r.id) then return new;end if;
 select * into m from private.wa_review_replacement_amendments where review_id=r.id;
 if m.review_id is null or a.account_id is distinct from r.account_id or a.flow is distinct from 'wa_new_number' or new.phone_number_id is distinct from m.phone_number_id then
 raise exception 'WA_REVIEW_REPLACEMENT_PHONE_MISMATCH' using errcode='23514';end if;
 return new;
end $$;
alter function private.wa_review_check_new_number() owner to postgres;
revoke all on function private.wa_review_check_new_number() from public,anon,authenticated,service_role;
create trigger wa_review_check_new_number before insert or update on private.es02_b3_whatsapp_signup_checkpoints
 for each row execute function private.wa_review_check_new_number();
create or replace function private.wa_review_replacement_fulfilled(p_review uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.wa_review_replacement_amendments m
 join private.wa_checkpoint_review_requests r on r.id=m.review_id
 join private.es02_b3_connection_attempts b on b.company_id=r.company_id and b.branch_id=r.branch_id and b.account_id=r.account_id
 join private.es02_b3_whatsapp_signup_checkpoints c on c.attempt_id=b.id
 join private.es02_b3_connection_links l on l.attempt_id=b.id and l.channel='whatsapp'
 where r.id=p_review and b.created_at>=m.recorded_at and b.flow='wa_new_number' and b.status='bound' and c.phone_number_id=m.phone_number_id)
 or exists(
  select 1 from private.wa_checkpoint_review_requests r
  join private.es02_b3_connection_attempts b on b.company_id=r.company_id and b.branch_id=r.branch_id and b.account_id=r.account_id
  join private.whatsapp_coexistence_signup_attempts w on w.id=b.legacy_attempt_id and w.company_id=b.company_id and w.user_id=b.account_id
  where r.id=p_review and r.status='closed_preserved' and b.created_at>=r.resolved_at
   and b.channel='whatsapp' and b.flow='wa_coexistence' and b.status='bound' and w.status='completed'
   and w.finalized_link_id is not null and w.finalized_link_generation is not null
   and encode(sha256(convert_to(w.expected_phone_number,'UTF8')),'hex')=r.replacement_phone_hash
 );
$$;
alter function private.wa_review_replacement_fulfilled(uuid) owner to postgres;
revoke all on function private.wa_review_replacement_fulfilled(uuid) from public,anon,authenticated,service_role;

create or replace function private.wa_review_check_replacement() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.wa_checkpoint_review_requests%rowtype; m private.wa_review_replacement_amendments%rowtype;
begin
 if new.channel<>'whatsapp' then return new;end if;
 select * into r from private.wa_checkpoint_review_requests x
 where x.company_id=new.company_id and x.branch_id=new.branch_id and x.status='closed_preserved'
 order by x.resolved_at desc,x.id desc limit 1;
 if r.id is not null and private.wa_review_replacement_fulfilled(r.id) then return new;end if;
 select * into m from private.wa_review_replacement_amendments where review_id=r.id;
 if m.review_id is not null then
  if new.account_id is distinct from r.account_id or new.flow is distinct from 'wa_new_number'
   or (new.confirmed_phone is not null and encode(sha256(convert_to(new.confirmed_phone,'UTF8')),'hex') is distinct from m.phone_hash) then
   raise exception 'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' using errcode='23514';end if;
  return new;
 end if;
 if r.id is not null and (new.account_id is distinct from r.account_id or new.flow is distinct from 'wa_coexistence'
  or (new.confirmed_phone is not null and encode(sha256(convert_to(new.confirmed_phone,'UTF8')),'hex') is distinct from r.replacement_phone_hash)) then
  raise exception 'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;

create or replace function private.wa_review_check_meta_phone() returns trigger
language plpgsql security definer set search_path='' as $$
declare r private.wa_checkpoint_review_requests%rowtype; b private.es02_b3_connection_attempts%rowtype; phone text;
begin
 if new.checkpoint_proof is null then return new;end if;
 select * into b from private.es02_b3_connection_attempts where legacy_attempt_id=new.id and company_id=new.company_id and channel='whatsapp';
 -- Review-scoped flows must never bypass the branch binding via a legacy RPC.
 if b.id is null then
  if exists(select 1 from private.wa_checkpoint_review_requests where company_id=new.company_id and status='closed_preserved') then
   raise exception 'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' using errcode='23514';
  end if;
  return new;
 end if;
 select * into r from private.wa_checkpoint_review_requests x
 where x.company_id=b.company_id and x.branch_id=b.branch_id and x.status='closed_preserved'
 order by x.resolved_at desc,x.id desc limit 1;
 if r.id is null or private.wa_review_replacement_fulfilled(r.id) then return new;end if;
 phone:=new.checkpoint_proof->>'display_phone_number';
 if phone is not null and length(phone)<=40 and phone ~ '^[+0-9() -]+$' then
  phone:=regexp_replace(phone,'[() -]','','g');
  if left(phone,1)<>'+' then phone:='+'||phone;end if;
 else phone:=null;end if;
 if exists(select 1 from private.wa_review_replacement_amendments where review_id=r.id) or b.flow is distinct from 'wa_coexistence' or b.account_id is distinct from r.account_id
  or new.user_id is distinct from r.account_id or phone is null or phone !~ '^[+][1-9][0-9]{6,14}$'
  or encode(sha256(convert_to(phone,'UTF8')),'hex') is distinct from r.replacement_phone_hash then
  raise exception 'WA_REVIEW_REPLACEMENT_PHONE_MISMATCH' using errcode='23514';
 end if;
 return new;
end $$;
alter function private.wa_review_check_meta_phone() owner to postgres;
revoke all on function private.wa_review_check_meta_phone() from public,anon,authenticated,service_role;
-- Existing checkpoint trigger remains attached.

-- Read-only preflight: never expose a phone/hash/credential to the browser.
create or replace function public.es02_b3_read_replacement_policy(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; sid uuid; r private.wa_checkpoint_review_requests%rowtype; binding jsonb;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false);end;
 if actor is null or actor is distinct from auth.uid() or sid is null or not private.es02_b3_session_open(actor,sid) then return jsonb_build_object('ok',false);end if;
 binding:=private.es02_b3_current_binding(actor,p_company_id,p_branch_id,'whatsapp');
 if binding->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false);end if;
 select * into r from private.wa_checkpoint_review_requests x
 where x.company_id=p_company_id and x.branch_id=p_branch_id and x.status='closed_preserved'
 order by x.resolved_at desc,x.id desc limit 1;
 return jsonb_build_object('ok',true,'requiresCoexistence',r.id is not null and not private.wa_review_replacement_fulfilled(r.id) and not exists(select 1 from private.wa_review_replacement_amendments where review_id=r.id));
end $$;
alter function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) owner to postgres;
revoke all on function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) to authenticated;

commit;
