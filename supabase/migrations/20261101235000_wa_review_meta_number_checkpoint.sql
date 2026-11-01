-- Preserve the reviewed replacement scope when the number is supplied by Meta.
-- A pending attempt grants no channel authority. Check the reviewed phone at
-- the verified checkpoint, before subscribe/finalize in finishCoexistenceSignup.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A review governs its replacement, not every future connection forever.
-- Only a fully finalized, branch-bound successor with the reviewed phone fulfills
-- it. A pending attempt, token checkpoint or provider-only success is insufficient.
create function private.wa_review_replacement_fulfilled(p_review uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
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
declare r private.wa_checkpoint_review_requests%rowtype;
begin
 if new.channel<>'whatsapp' then return new;end if;
 select * into r from private.wa_checkpoint_review_requests x
 where x.company_id=new.company_id and x.branch_id=new.branch_id and x.status='closed_preserved'
 order by x.resolved_at desc,x.id desc limit 1;
 if r.id is not null and private.wa_review_replacement_fulfilled(r.id) then return new;end if;
 if r.id is not null and (new.account_id is distinct from r.account_id or new.flow is distinct from 'wa_coexistence'
  or (new.confirmed_phone is not null and encode(sha256(convert_to(new.confirmed_phone,'UTF8')),'hex') is distinct from r.replacement_phone_hash)) then
  raise exception 'WA_REVIEW_REPLACEMENT_SCOPE_REQUIRED' using errcode='23514';
 end if;
 return new;
end $$;

create function private.wa_review_check_meta_phone() returns trigger
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
 if b.flow is distinct from 'wa_coexistence' or b.account_id is distinct from r.account_id
  or new.user_id is distinct from r.account_id or phone is null or phone !~ '^[+][1-9][0-9]{6,14}$'
  or encode(sha256(convert_to(phone,'UTF8')),'hex') is distinct from r.replacement_phone_hash then
  raise exception 'WA_REVIEW_REPLACEMENT_PHONE_MISMATCH' using errcode='23514';
 end if;
 return new;
end $$;
alter function private.wa_review_check_meta_phone() owner to postgres;
revoke all on function private.wa_review_check_meta_phone() from public,anon,authenticated,service_role;
create trigger wa_review_check_meta_phone before insert or update on private.whatsapp_coexistence_signup_attempts
 for each row execute function private.wa_review_check_meta_phone();

-- Read-only preflight: never expose a phone/hash/credential to the browser.
create function public.es02_b3_read_replacement_policy(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid)
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
 return jsonb_build_object('ok',true,'requiresCoexistence',r.id is not null and not private.wa_review_replacement_fulfilled(r.id));
end $$;
alter function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) owner to postgres;
revoke all on function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_b3_read_replacement_policy(uuid,uuid,uuid) to authenticated;
commit;
