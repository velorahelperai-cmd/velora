-- Pending review receipt only: no provider, checkpoint, attempt or Vault mutation.
begin;
create table private.wa_checkpoint_review_requests(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references auth.users(id) on delete restrict,session_id uuid not null,original_session_id uuid not null,
 company_id uuid not null references public.companies(id) on delete restrict,branch_id uuid not null,attempt_id uuid not null references private.es02_b3_connection_attempts(id) on delete restrict,generation integer not null check(generation>0),
 status text not null default 'pending' check(status='pending'),reason text not null default 'EXPIRED_CHECKPOINT' check(reason='EXPIRED_CHECKPOINT'),
 requested_at timestamptz not null default clock_timestamp(),unique(attempt_id,generation),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id) on delete restrict
);
alter table private.wa_checkpoint_review_requests enable row level security;
revoke all on private.wa_checkpoint_review_requests from public,anon,authenticated,service_role;
create function public.wa_owned_checkpoint_review_request(p_expected_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,p_attempt_id uuid,p_generation integer,p_request boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid;a private.es02_b3_connection_attempts%rowtype;r private.wa_checkpoint_review_requests%rowtype;observed jsonb;
begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false);end;
 if p_expected_account_id is null or p_expected_account_id is distinct from auth.uid() or sid is null or sid is distinct from p_session_id or not private.es02_b3_session_open(p_expected_account_id,sid) then return jsonb_build_object('ok',false);end if;
 if p_request is null or p_generation is null or p_generation<1 then return jsonb_build_object('ok',false);end if;
 observed:=private.es02_b3_current_binding(p_expected_account_id,p_company_id,p_branch_id,'whatsapp');
 if observed->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false);end if;
 select * into a from private.es02_b3_connection_attempts x where x.id=p_attempt_id and x.account_id=p_expected_account_id and x.company_id=p_company_id and x.branch_id=p_branch_id and x.generation=p_generation and x.channel='whatsapp' and x.flow='wa_new_number' for update;
 if a.id is null or a.status not in ('pending','claimed','unknown') or a.expires_at>clock_timestamp() or not private.es02_b3_pin_matches(a,observed) then return jsonb_build_object('ok',false);end if;
 -- Review requests use the current owner session, not the expired provider authorization session.
 -- Session UUIDs are immutable audit snapshots, deliberately not FKs to ephemeral auth.sessions.
 -- Presence only; never decrypt or return credentials.
 if not exists(select 1 from private.es02_b3_whatsapp_signup_checkpoints c where c.attempt_id=a.id and c.token_secret_id is not null) then return jsonb_build_object('ok',false);end if;
 if p_request then
 insert into private.wa_checkpoint_review_requests(account_id,session_id,original_session_id,company_id,branch_id,attempt_id,generation)
 values(p_expected_account_id,sid,a.session_id,p_company_id,p_branch_id,p_attempt_id,p_generation) on conflict(attempt_id,generation) do nothing;
 end if;
 select * into r from private.wa_checkpoint_review_requests where attempt_id=p_attempt_id and generation=p_generation and account_id=p_expected_account_id and company_id=p_company_id and branch_id=p_branch_id;
 if r.id is null then return jsonb_build_object('ok',true,'receipt',null);end if;
 return jsonb_build_object('ok',true,'receipt',jsonb_build_object('id',r.id,'attemptId',r.attempt_id,'generation',r.generation,'status',r.status,'requestedAt',r.requested_at));
end $$;
revoke all on function public.wa_owned_checkpoint_review_request(uuid,uuid,uuid,uuid,uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.wa_owned_checkpoint_review_request(uuid,uuid,uuid,uuid,uuid,integer,boolean) to authenticated;
commit;
