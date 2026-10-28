-- LOCAL ONLY: additive branch authority on the deployed company membership model.
begin;
set local lock_timeout='5s';
-- A branch membership must never satisfy legacy company-wide status='active' gates.
alter table public.company_members add column es02_branch_only boolean not null default false;
alter table public.company_members drop constraint company_members_status_check;
alter table public.company_members add constraint company_members_status_check check(status in ('active','disabled','branch_active'));
alter table public.company_members add constraint es02_branch_member_scope check (
 (not es02_branch_only and status<>'branch_active') or (es02_branch_only and role='staff' and status in ('branch_active','disabled')));
create function private.es02_preserve_member_scope() returns trigger language plpgsql set search_path='' as $$
begin
 if old.es02_branch_only is distinct from new.es02_branch_only then raise exception 'MEMBER_SCOPE_IMMUTABLE' using errcode='23514';end if;
 return new;
end;$$;
create trigger es02_preserve_member_scope before update on public.company_members for each row execute function private.es02_preserve_member_scope();
create table private.es02_team_invitation_scope (
 invitation_id uuid primary key references private.staff_invitations(id) on delete cascade,
 company_id uuid not null references public.companies(id),
 branch_id uuid not null,
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 capabilities text[] not null check(cardinality(capabilities)>0 and capabilities <@ array['wa.conversations.read','ig.conversations.read']::text[] and array_position(capabilities,null) is null)
);
create table private.es02_branch_member_grants (
 company_id uuid not null,user_id uuid not null,branch_id uuid not null,
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 capabilities text[] not null check(cardinality(capabilities)>0 and capabilities <@ array['wa.conversations.read','ig.conversations.read']::text[] and array_position(capabilities,null) is null),
 status text not null default 'active' check(status in ('active','revoked')),
 revision integer not null default 1,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,user_id,branch_id),
 foreign key(company_id,user_id) references public.company_members(company_id,user_id) on delete cascade
);
alter table private.es02_team_invitation_scope enable row level security;
alter table private.es02_branch_member_grants enable row level security;
revoke all on private.es02_team_invitation_scope,private.es02_branch_member_grants from public,anon,authenticated,service_role;
create function private.es02_team_recipients(cid uuid,bid uuid) returns table(email text)
language sql volatile security definer set search_path='' as $$
 select lower(u.email) from private.es02_branch_member_grants g join public.company_members m using(company_id,user_id) join auth.users u on u.id=g.user_id
 where g.company_id=cid and g.branch_id=bid and g.status='active' and m.es02_branch_only and m.status='branch_active'
 union
 select lower(u.email) from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=cid and m.role='staff' and m.status='active'
 union
 select i.email from private.staff_invitations i left join private.es02_team_invitation_scope s on s.invitation_id=i.id
 where i.company_id=cid and (s.invitation_id is null or (s.company_id=cid and s.branch_id=bid)) and i.accepted_at is null and i.cancelled_at is null and i.expires_at>clock_timestamp()
$$;
create function private.es02_team_reserve(cid uuid,bid uuid,recipient text) returns void
language plpgsql volatile security definer set search_path='' as $$
declare capacity integer;used integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('es02-team:'||bid::text,0));
 if not exists(select 1 from public.company_branches where id=bid and company_id=cid and status in ('setup','active')) then raise exception 'FORBIDDEN' using errcode='23514';end if;
 select employees into capacity from private.es02_branch_slot_rights where company_id=cid and branch_id=bid for share;
 if capacity is null or capacity not in (2,4) then raise exception 'ENTITLEMENT_UNAVAILABLE' using errcode='23514';end if;
 select count(*) into used from (select email from private.es02_team_recipients(cid,bid) union select lower(recipient)) recipients;
 if recipient is null or used>capacity then raise exception 'TEAM_SEATS_FULL' using errcode='23514';end if;
end;$$;
-- Deferred checks see the final invitation scope and preserve existing over-capacity
-- rows without rewriting them. New legacy company-wide seats count in every paid branch.
create function private.es02_legacy_team_seat_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare bid uuid;recipient text;scope_id uuid;
begin
 if tg_table_name='staff_invitations' then
  if not exists(select 1 from private.staff_invitations where id=new.id and accepted_at is null and cancelled_at is null and expires_at>clock_timestamp()) then return null;end if;
  select branch_id into scope_id from private.es02_team_invitation_scope where invitation_id=new.id;
  recipient:=new.email;
 else
  if new.role<>'staff' or new.status<>'active' then return null;end if;
  if tg_op='UPDATE' and old.status='active' and old.role='staff' and old.company_id=new.company_id and old.user_id=new.user_id then return null;end if;
  -- Acceptance swaps an already reserved invitation for a membership, not a new seat.
  if tg_op='INSERT' and exists(select 1 from private.staff_invitations i where i.company_id=new.company_id and i.accepted_by=new.user_id and i.accepted_at>=transaction_timestamp() and i.created_at<transaction_timestamp() and not exists(select 1 from private.es02_team_invitation_scope s where s.invitation_id=i.id)) then return null;end if;
  select email into recipient from auth.users where id=new.user_id;
 end if;
 for bid in select r.branch_id from private.es02_branch_slot_rights r join public.company_branches b on b.id=r.branch_id and b.company_id=r.company_id and b.status in ('setup','active') where r.company_id=new.company_id and (scope_id is null or r.branch_id=scope_id) order by r.branch_id loop
  perform private.es02_team_reserve(new.company_id,bid,recipient);
 end loop;
 return null;
end;$$;
create constraint trigger es02_legacy_invitation_seats after insert or update on private.staff_invitations deferrable initially deferred for each row execute function private.es02_legacy_team_seat_guard();
create constraint trigger es02_legacy_membership_seats after insert or update on public.company_members deferrable initially deferred for each row execute function private.es02_legacy_team_seat_guard();
revoke all on function private.es02_legacy_team_seat_guard() from public,anon,authenticated,service_role;
create function public.es02_read_owned_branch_team(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare authority jsonb;capacity integer;used integer;rows jsonb;scope jsonb;label text;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 select employees into capacity from private.es02_branch_slot_rights where company_id=p_company_id and branch_id=p_branch_id;
 if capacity is null or capacity not in (2,4) then return jsonb_build_object('ok',false,'code','ENTITLEMENT_UNAVAILABLE');end if;
 select name into label from public.company_branches where id=p_branch_id and company_id=p_company_id;
 select count(*) into used from private.es02_team_recipients(p_company_id,p_branch_id);
 scope:=jsonb_build_object('expectedAccountId',p_expected_account_id,'companyId',p_company_id,'branchId',p_branch_id);
 select coalesce(jsonb_agg(jsonb_build_object('scope',scope,'invitation',private.staff_invitation_projection(i.id)||case when i.accepted_at is not null then jsonb_build_object('revision',coalesce(g.revision,1),'status',case when g.status='revoked' then 'cancelled' else 'accepted' end) else '{}'::jsonb end) order by i.created_at desc),'[]') into rows
 from private.staff_invitations i join private.es02_team_invitation_scope s on s.invitation_id=i.id
 left join private.es02_branch_member_grants g on g.company_id=s.company_id and g.branch_id=s.branch_id and g.user_id=i.accepted_by
 where s.company_id=p_company_id and s.branch_id=p_branch_id;
 return jsonb_build_object('ok',true,'snapshot',jsonb_build_object('scope',scope,'version',1,'branchLabel',label,
 'seats',jsonb_build_object('limit',capacity,'available',greatest(0,capacity-used)),'allowedRoles',jsonb_build_array('staff'),
 'canInvite',used<capacity,'canReplace',false,'canRevoke',true,'canSkip',false,'skip','not_skipped','createOperationId',gen_random_uuid(),'skipOperationId',null,'invitations',rows));
end;$$;
create function public.es02_invite_owned_branch_team(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_expected_version integer,p_operation_id uuid,p_name text,p_email text,p_capabilities text[],p_token_hash text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare authority jsonb;result jsonb;saved_id uuid;prior private.staff_invitation_operations%rowtype;payload_key jsonb;email_key text:=lower(btrim(p_email));caps text[];
begin
 if p_expected_version is distinct from 1 or p_operation_id is null or p_capabilities is null or cardinality(p_capabilities)<1 or not p_capabilities <@ array['wa.conversations.read','ig.conversations.read']::text[] or array_position(p_capabilities,null) is not null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 caps:=array(select distinct c from unnest(p_capabilities)c order by c);
 payload_key:=jsonb_build_object('action','es02_branch_create','branchId',p_branch_id,'email',email_key,'name',btrim(p_name),'capabilities',caps);
 perform pg_advisory_xact_lock(hashtextextended('staff-operation:'||p_operation_id::text,0));
 select * into prior from private.staff_invitation_operations where operation_id=p_operation_id;
 if found then
  if prior.actor_id is distinct from auth.uid() or prior.company_id<>p_company_id or prior.payload<>payload_key then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  return jsonb_build_object('ok',true,'outcome',prior.outcome,'replayed',true,'tokenMatched',false,'invitation',private.staff_invitation_projection(prior.invitation_id),'snapshot',public.es02_read_owned_branch_team(p_expected_account_id,p_company_id,p_branch_id)->'snapshot');
 end if;
 -- Native recipient lock/order and validation remain the source of truth.
 result:=public.mutate_staff_invitation(p_company_id,p_operation_id,'create',p_email,p_name,null,null,p_token_hash);
 if result->>'ok' is distinct from 'true' then return result;end if;
 saved_id:=(result->'invitation'->>'id')::uuid;
 if result->>'outcome'='existing' then
  if not exists(select 1 from private.es02_team_invitation_scope where invitation_id=saved_id and company_id=p_company_id and branch_id=p_branch_id and capabilities=caps) then
   raise exception 'INVITATION_SCOPE_CONFLICT' using errcode='23514';
  end if;
 else
  perform private.es02_team_reserve(p_company_id,p_branch_id,email_key);
  insert into private.es02_team_invitation_scope values(saved_id,p_company_id,p_branch_id,caps);
 end if;
 update private.staff_invitation_operations set payload=payload_key where operation_id=p_operation_id;
 return result||jsonb_build_object('snapshot',public.es02_read_owned_branch_team(p_expected_account_id,p_company_id,p_branch_id)->'snapshot');
exception when check_violation then
 if sqlerrm in ('TEAM_SEATS_FULL','ENTITLEMENT_UNAVAILABLE','FORBIDDEN','INVITATION_SCOPE_CONFLICT') then return jsonb_build_object('ok',false,'code',sqlerrm);end if;raise;
end;$$;
-- Preserve the exact deployed company invitation implementation and its security checks.
-- Rename retains dependencies; only the public wrapper below is exposed afterwards.
alter function public.accept_staff_invitation(text) rename to es02_accept_company_staff_invitation;
alter function public.es02_accept_company_staff_invitation(text) set schema private;
revoke all on function private.es02_accept_company_staff_invitation(text) from public,anon,authenticated,service_role;
create function public.accept_staff_invitation(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid;invite private.staff_invitations%rowtype;s private.es02_team_invitation_scope%rowtype;member public.company_members%rowtype;caller_email text;
begin
 uid:=private.staff_invitation_actor(true);
 select * into invite from private.staff_invitations where token_hash=p_token_hash;
 select * into s from private.es02_team_invitation_scope where invitation_id=invite.id;
 if not found then return private.es02_accept_company_staff_invitation(p_token_hash);end if;
 perform 1 from public.companies where id=invite.company_id and status in ('setup','active') for share;
 if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 perform 1 from public.company_members where company_id=invite.company_id and user_id=invite.invited_by and role='owner' and status='active' for share;
 if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 select lower(email) into caller_email from auth.users where id=uid and email_confirmed_at is not null for share;
 if caller_email is distinct from invite.email then return jsonb_build_object('ok',false,'code','EMAIL_MISMATCH');end if;
 perform 1 from private.staff_invitation_recipients where company_id=invite.company_id and email=invite.email for update;
 select * into invite from private.staff_invitations where id=invite.id for update;
 select * into member from public.company_members where company_id=invite.company_id and user_id=uid for update;
 if invite.accepted_at is not null then
  if invite.accepted_by=uid and member.es02_branch_only and member.status='branch_active' and exists(select 1 from private.es02_branch_member_grants where company_id=invite.company_id and user_id=uid and branch_id=s.branch_id and status='active') then return jsonb_build_object('ok',true,'companyId',invite.company_id,'branchId',s.branch_id);end if;
  return jsonb_build_object('ok',false,'code','INVITE_INVALID');
 end if;
 if invite.cancelled_at is not null or invite.expires_at<=clock_timestamp() or (select count(*) from private.staff_invitations where company_id=invite.company_id and email=invite.email and accepted_at is null and cancelled_at is null)<>1 then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 if member.user_id is not null then return jsonb_build_object('ok',false,'code','MEMBER_EXISTS');end if;
 perform private.es02_team_reserve(invite.company_id,s.branch_id,invite.email);
 insert into public.company_members(company_id,user_id,role,status,member_name,es02_branch_only) values(invite.company_id,uid,'staff','branch_active',invite.member_name,true);
 insert into private.es02_branch_member_grants(company_id,user_id,branch_id,capabilities,updated_by) values(invite.company_id,uid,s.branch_id,s.capabilities,invite.invited_by);
 update private.staff_invitations set accepted_at=clock_timestamp(),accepted_by=uid where id=invite.id;
 update private.staff_invitation_recipients set revision=revision+1 where company_id=invite.company_id and email=invite.email;
 perform private.write_admin_audit(uid,invite.company_id,'es02.branch_invitation.accepted','{}',jsonb_build_object('invitationId',invite.id,'branchId',s.branch_id));
 return jsonb_build_object('ok',true,'companyId',invite.company_id,'branchId',s.branch_id);
exception when insufficient_privilege or check_violation then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
create function public.es02_set_owned_branch_member(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_user_id uuid,p_capabilities text[],p_revoke boolean,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare authority jsonb;member public.company_members%rowtype;g private.es02_branch_member_grants%rowtype;recipient text;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_revoke is null or p_expected_revision is null or p_expected_revision<0 or (not p_revoke and (p_capabilities is null or cardinality(p_capabilities)<1 or not p_capabilities <@ array['wa.conversations.read','ig.conversations.read']::text[] or array_position(p_capabilities,null) is not null)) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into member from public.company_members where company_id=p_company_id and user_id=p_user_id for update;
 if not found or not member.es02_branch_only or member.status<>'branch_active' then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into g from private.es02_branch_member_grants where company_id=p_company_id and user_id=p_user_id and branch_id=p_branch_id for update;
 if coalesce(g.revision,0)<>p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_REVISION');end if;
 if p_revoke then
  if g.user_id is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  update private.es02_branch_member_grants set status='revoked',revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company_id and user_id=p_user_id and branch_id=p_branch_id;
 else
  select email into recipient from auth.users where id=p_user_id;
  if g.user_id is null or g.status<>'active' then perform private.es02_team_reserve(p_company_id,p_branch_id,recipient);end if;
  insert into private.es02_branch_member_grants(company_id,user_id,branch_id,capabilities,updated_by) values(p_company_id,p_user_id,p_branch_id,p_capabilities,auth.uid())
   on conflict(company_id,user_id,branch_id) do update set capabilities=excluded.capabilities,status='active',revision=es02_branch_member_grants.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 end if;
 perform private.write_admin_audit(auth.uid(),p_company_id,'es02.branch_grant.changed','{}',jsonb_build_object('branchId',p_branch_id,'userId',p_user_id,'revoked',p_revoke));
 return jsonb_build_object('ok',true,'revision',coalesce(g.revision,0)+1);
exception when check_violation then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
create function public.es02_revoke_owned_branch_team(p_expected_account_id uuid,p_company_id uuid,p_branch_id uuid,p_invitation_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare authority jsonb;i private.staff_invitations%rowtype;r jsonb;
begin
 authority:=public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
 if authority->>'ok' is distinct from 'true' then return authority;end if;
 if p_expected_revision is null or p_expected_revision<1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select i0.* into i from private.staff_invitations i0 join private.es02_team_invitation_scope s on s.invitation_id=i0.id where i0.id=p_invitation_id and s.company_id=p_company_id and s.branch_id=p_branch_id;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Same recipient-first order as acceptance and native cancellation.
 perform 1 from private.staff_invitation_recipients where company_id=p_company_id and email=i.email for update;
 select * into i from private.staff_invitations where id=p_invitation_id for update;
 if i.accepted_at is null then
  r:=public.mutate_staff_invitation(p_company_id,gen_random_uuid(),'cancel',null,null,p_invitation_id,p_expected_revision,null);
 else
  r:=public.es02_set_owned_branch_member(p_expected_account_id,p_company_id,p_branch_id,i.accepted_by,null,true,p_expected_revision);
 end if;
 if r->>'ok' is distinct from 'true' then return r;end if;
 return jsonb_build_object('ok',true,'snapshot',public.es02_read_owned_branch_team(p_expected_account_id,p_company_id,p_branch_id)->'snapshot');
end;$$;
create function public.es02_has_branch_capability(p_company_id uuid,p_branch_id uuid,p_capability text) returns boolean
language sql stable security definer set search_path='' as $$
 select public.app_session_is_valid() and exists(select 1 from public.companies c join public.company_branches b on b.company_id=c.id
 join public.company_members m on m.company_id=c.id and m.user_id=auth.uid()
 where c.id=p_company_id and c.status in ('setup','active') and b.id=p_branch_id and b.status in ('setup','active') and
 ((m.status='active' and public.has_company_capability(p_company_id,p_capability)) or (m.es02_branch_only and m.status='branch_active' and exists(
 select 1 from private.es02_branch_member_grants g where g.company_id=c.id and g.user_id=m.user_id and g.branch_id=b.id and g.status='active' and p_capability=any(g.capabilities)))))
$$;
-- Read-only branch entry points. Legacy company RPCs keep their existing gates.
create function public.es02_list_my_branch_access() returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;items jsonb;
begin
 uid:=private.staff_invitation_actor(false);
 select coalesce(jsonb_agg(jsonb_build_object('companyId',g.company_id,'branchId',g.branch_id,'branchLabel',b.name,'capabilities',g.capabilities) order by b.name),'[]') into items
 from private.es02_branch_member_grants g join public.company_members m using(company_id,user_id)
 join public.company_branches b on b.id=g.branch_id and b.company_id=g.company_id
 join public.companies c on c.id=g.company_id
 where g.user_id=uid and g.status='active' and m.es02_branch_only and m.status='branch_active' and b.status in ('setup','active') and c.status in ('setup','active');
 return jsonb_build_object('ok',true,'branches',items);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
create function public.es02_read_branch_inbox(p_company_id uuid,p_branch_id uuid,p_channel text,p_conversation_id uuid default null,p_before bigint default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;account_key text;items jsonb;messages jsonb;conv jsonb;next_seq bigint;more boolean;
begin
 uid:=private.staff_invitation_actor(false);
 if p_channel is null or p_channel not in ('whatsapp','instagram') or p_limit is null or p_limit not between 1 and 100 or p_before<=0 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Hold membership and grant authority through projection so revocation is ordered with reads.
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and ((es02_branch_only and status='branch_active') or (role='owner' and status='active')) for share;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from private.es02_branch_member_grants where company_id=p_company_id and user_id=uid and branch_id=p_branch_id for share;
 if not public.es02_has_branch_capability(p_company_id,p_branch_id,case when p_channel='whatsapp' then 'wa.conversations.read' else 'ig.conversations.read' end)
 or not private.billing_chat_access(p_company_id,p_channel) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_channel='whatsapp' then
  select l.provider_phone_number_id into account_key from private.es02_b3_connection_links b join public.whatsapp_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='verified' and l.authorization_status='active' and (l.authorization_expires_at is null or l.authorization_expires_at>clock_timestamp()) for share of b,l;
 else
  select l.account_id into account_key from private.es02_b3_connection_links b join private.instagram_company_links l on l.id=b.legacy_link_id and l.company_id=b.company_id and l.generation=b.legacy_generation
  where b.company_id=p_company_id and b.branch_id=p_branch_id and b.channel=p_channel and b.verified and b.status='active' and b.revoked_at is null and l.status='active' and l.authorization_expires_at>clock_timestamp() for share of b,l;
 end if;
 if account_key is null or not private.billing_history_account_allowed(p_company_id,p_channel,account_key) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_channel='whatsapp' then
  if p_conversation_id is null then
   with eligible as (select c from public.whatsapp_conversations c where c.company_id=p_company_id and c.phone_number_id=account_key and (p_before is null or c.inbox_sequence<p_before) order by c.inbox_sequence desc limit p_limit+1),
   page as (select c from eligible order by (c).inbox_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.whatsapp_inbox_conversation_public(c,uid) order by (c).inbox_sequence desc),'[]'),min((c).inbox_sequence),(select count(*)>p_limit from eligible) into items,next_seq,more from page;
  else
   select private.whatsapp_inbox_conversation_public(c,uid) into conv from public.whatsapp_conversations c where c.company_id=p_company_id and c.id=p_conversation_id and c.phone_number_id=account_key;
   if conv is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   with eligible as (select m from public.whatsapp_messages m where m.company_id=p_company_id and m.conversation_id=p_conversation_id and (p_before is null or m.arrival_sequence<p_before) order by m.arrival_sequence desc limit p_limit+1),
   page as (select m from eligible order by (m).arrival_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.whatsapp_inbox_message_public(m) order by (m).arrival_sequence),'[]'),min((m).arrival_sequence),(select count(*)>p_limit from eligible) into messages,next_seq,more from page;
  end if;
 else
  if p_conversation_id is null then
   with eligible as (select c from private.instagram_conversations c where c.company_id=p_company_id and c.account_id=account_key and (p_before is null or c.inbox_sequence<p_before) order by c.inbox_sequence desc limit p_limit+1),
   page as (select c from eligible order by (c).inbox_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.instagram_inbox_item(c,uid) order by (c).inbox_sequence desc),'[]'),min((c).inbox_sequence),(select count(*)>p_limit from eligible) into items,next_seq,more from page;
  else
   select private.instagram_inbox_item(c,uid) into conv from private.instagram_conversations c where c.company_id=p_company_id and c.id=p_conversation_id and c.account_id=account_key;
   if conv is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   with eligible as (select m from private.instagram_messages m where m.company_id=p_company_id and m.conversation_id=p_conversation_id and (p_before is null or m.arrival_sequence<p_before) order by m.arrival_sequence desc limit p_limit+1),
   page as (select m from eligible order by (m).arrival_sequence desc limit p_limit)
   select coalesce(jsonb_agg(private.instagram_inbox_message(m) order by (m).arrival_sequence),'[]'),min((m).arrival_sequence),(select count(*)>p_limit from eligible) into messages,next_seq,more from page;
  end if;
 end if;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'branchId',p_branch_id,'channel',p_channel,'conversations',items,'conversation',conv,'messages',messages,'has_more',more,'next_cursor',case when more then next_seq::text end);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
revoke all on function public.es02_list_my_branch_access(),public.es02_read_branch_inbox(uuid,uuid,text,uuid,bigint,integer) from public,anon;
grant execute on function public.es02_list_my_branch_access(),public.es02_read_branch_inbox(uuid,uuid,text,uuid,bigint,integer) to authenticated;
-- Branch invites cannot be replaced by the legacy company-scope recovery path.
create function private.es02_guard_branch_replacement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.superseded_by is not null and exists(select 1 from private.es02_team_invitation_scope where invitation_id=new.id) then raise exception 'BRANCH_INVITATION_REPLACE_UNSUPPORTED' using errcode='23514';end if;
 return new;
end;$$;
create trigger es02_guard_branch_replacement before update on private.staff_invitations for each row execute function private.es02_guard_branch_replacement();
revoke all on function private.es02_preserve_member_scope(),private.es02_team_recipients(uuid,uuid),private.es02_team_reserve(uuid,uuid,text),private.es02_guard_branch_replacement() from public,anon,authenticated,service_role;
revoke all on function public.es02_read_owned_branch_team(uuid,uuid,uuid),public.es02_invite_owned_branch_team(uuid,uuid,uuid,integer,uuid,text,text,text[],text),public.accept_staff_invitation(text),public.es02_set_owned_branch_member(uuid,uuid,uuid,uuid,text[],boolean,integer),public.es02_has_branch_capability(uuid,uuid,text),public.es02_revoke_owned_branch_team(uuid,uuid,uuid,uuid,integer) from public,anon;
grant execute on function public.es02_read_owned_branch_team(uuid,uuid,uuid),public.es02_invite_owned_branch_team(uuid,uuid,uuid,integer,uuid,text,text,text[],text),public.accept_staff_invitation(text),public.es02_set_owned_branch_member(uuid,uuid,uuid,uuid,text[],boolean,integer),public.es02_has_branch_capability(uuid,uuid,text),public.es02_revoke_owned_branch_team(uuid,uuid,uuid,uuid,integer) to authenticated;
commit;
