-- ADMIN-SUPPORT-REPAIR-20261022: REVIEW CANDIDATE ONLY; NOT APPLIED.
-- Replaces the unapplied 20261022100000 review draft, not an installed migration.
-- Target: vmpifljyozsbtssxhoxd. Requires separate exact-artifact approval.
-- Verified read-only baseline: both support tables absent; company_branches UUID IDs present.
-- No tenant/delegated access, direct browser DML, provider calls or production execution.
begin;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  company_id uuid not null references public.companies(id) on delete restrict,
  branch_id uuid,
  creator_user_id uuid not null references auth.users(id),
  assigned_to_user_id uuid references auth.users(id),
  title text not null check(char_length(btrim(title)) between 3 and 200),
  description text not null check(char_length(btrim(description)) between 5 and 10000),
  status text not null default 'open' check(status in ('open','in_progress','waiting_customer','resolved','closed')),
  priority text not null default 'medium' check(priority in ('low','medium','high','urgent')),
  category text not null default 'technical' check(category in ('onboarding','billing','technical','channel','ai','other')),
  resolution_summary text check(char_length(resolution_summary)<=10000),
  revision bigint not null default 1 check(revision>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  resolved_at timestamptz,
  constraint support_ticket_branch_company_fk foreign key(company_id,branch_id)
    references public.company_branches(company_id,id) on delete restrict
);
create table public.ticket_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  author_user_id uuid not null references auth.users(id),
  note_type text not null check(note_type in ('internal_note','status_change','assignment','customer_response')),
  content text not null check(char_length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default clock_timestamp()
);
create table private.admin_support_operations (
  actor_user_id uuid not null references auth.users(id),
  operation_id uuid not null,
  kind text not null,
  input jsonb not null,
  expected_revision bigint,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_user_id,operation_id)
);
alter table public.support_tickets owner to postgres;
alter table public.ticket_notes owner to postgres;
alter table private.admin_support_operations owner to postgres;
create index support_tickets_page_idx on public.support_tickets(created_at desc,id desc);
create index support_tickets_company_idx on public.support_tickets(company_id,created_at desc,id desc);
create index support_tickets_status_idx on public.support_tickets(status,priority);
create index ticket_notes_ticket_idx on public.ticket_notes(ticket_id,created_at,id);
alter table public.support_tickets enable row level security;
alter table public.ticket_notes enable row level security;
alter table private.admin_support_operations enable row level security;
revoke all on table public.support_tickets,public.ticket_notes,private.admin_support_operations from public,anon,authenticated,service_role;
grant select on table public.support_tickets,public.ticket_notes to authenticated;
create policy support_tickets_owner_read on public.support_tickets for select to authenticated
  using(public.billing_admin_authorized_session());
create policy ticket_notes_owner_read on public.ticket_notes for select to authenticated
  using(public.billing_admin_authorized_session());

-- One RPC owns the ticket + optional note + safe audit + idempotency receipt transaction.
-- Session gate is the existing strict native owner gate, not user metadata.
create function public.admin_support_mutate(
  p_operation_id uuid,p_kind text,p_input jsonb,p_expected_revision bigint default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_prior private.admin_support_operations%rowtype;
  v_ticket public.support_tickets%rowtype;
  v_before public.support_tickets%rowtype;
  v_note public.ticket_notes%rowtype;
  v_ticket_id uuid;
  v_assignee uuid;
  v_now timestamptz:=clock_timestamp();
  v_result jsonb;
  v_text text;
  v_target_status text;
begin
  if v_actor is null or public.billing_admin_authorized_session() is distinct from true then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_operation_id is null or p_input is null or jsonb_typeof(p_input)<>'object'
     or p_kind is null or p_kind not in ('create','status','assign','note') then
    raise exception 'invalid_input' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_operation_id::text,0));
  select * into v_prior from private.admin_support_operations
    where actor_user_id=v_actor and operation_id=p_operation_id;
  if found then
    if v_prior.kind<>p_kind or v_prior.input<>p_input
       or v_prior.expected_revision is distinct from p_expected_revision then
      return jsonb_build_object('ok',false,'code','CONFLICT');
    end if;
    return v_prior.result;
  end if;
  if p_kind='create' then
    if p_expected_revision is not null then raise exception 'invalid_revision' using errcode='22023'; end if;
    v_assignee:=nullif(p_input->>'assignedToUserId','')::uuid;
    if v_assignee is not null and not exists(
      select 1 from public.platform_admins where user_id=v_assignee and role='owner' and status='active'
    ) then raise exception 'assignee_not_authorized' using errcode='22023'; end if;
    v_ticket_id:=gen_random_uuid();
    insert into public.support_tickets(id,ticket_number,company_id,branch_id,creator_user_id,assigned_to_user_id,title,description,priority,category)
    values(v_ticket_id,'TICK-'||upper(v_ticket_id::text),(p_input->>'companyId')::uuid,
      nullif(p_input->>'branchId','')::uuid,v_actor,v_assignee,btrim(p_input->>'title'),btrim(p_input->>'description'),
      coalesce(p_input->>'priority','medium'),coalesce(p_input->>'category','technical')) returning * into v_ticket;
    v_text:=btrim(p_input->>'initialNote');
    if coalesce(v_text,'')<>'' then
      insert into public.ticket_notes(ticket_id,author_user_id,note_type,content)
        values(v_ticket.id,v_actor,'internal_note',v_text);
    end if;
  else
    v_ticket_id:=(p_input->>'ticketId')::uuid;
    if p_expected_revision is null or p_expected_revision<1 then raise exception 'revision_required' using errcode='22023'; end if;
    select * into v_ticket from public.support_tickets where id=v_ticket_id for update;
    if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
    if v_ticket.revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','CONFLICT'); end if;
    v_before:=v_ticket;
    if p_kind='status' then
      v_target_status:=p_input->>'status';
      if v_target_status is null or v_target_status not in ('open','in_progress','waiting_customer','resolved','closed') then
        raise exception 'invalid_status' using errcode='22023';
      end if;
      -- Existing owner UI allows close/reopen; no new business transition policy introduced.
      update public.support_tickets set status=v_target_status,
        resolution_summary=case when p_input?'resolutionSummary' then p_input->>'resolutionSummary' else resolution_summary end,
        closed_at=case when v_target_status='closed' then v_now else null end,
        resolved_at=case when v_target_status='resolved' then v_now when v_target_status='closed' then resolved_at else null end,
        updated_at=v_now,revision=revision+1 where id=v_ticket_id returning * into v_ticket;
    elsif p_kind='assign' then
      v_assignee:=nullif(p_input->>'assignedToUserId','')::uuid;
      if v_assignee is not null and not exists(
        select 1 from public.platform_admins where user_id=v_assignee and role='owner' and status='active'
      ) then raise exception 'assignee_not_authorized' using errcode='22023'; end if;
      update public.support_tickets set assigned_to_user_id=v_assignee,updated_at=v_now,revision=revision+1
        where id=v_ticket_id returning * into v_ticket;
    else
      if coalesce(p_input->>'noteType','internal_note') not in ('internal_note','customer_response') then
        raise exception 'invalid_note_type' using errcode='22023';
      end if;
      insert into public.ticket_notes(ticket_id,author_user_id,note_type,content)
        values(v_ticket_id,v_actor,coalesce(p_input->>'noteType','internal_note'),btrim(p_input->>'content')) returning * into v_note;
      update public.support_tickets set updated_at=v_now,revision=revision+1 where id=v_ticket_id returning * into v_ticket;
    end if;
    if p_kind in ('status','assign') then
      v_text:=btrim(p_input->>'internalNote');
      if coalesce(v_text,'')<>'' then
        insert into public.ticket_notes(ticket_id,author_user_id,note_type,content)
          values(v_ticket_id,v_actor,case when p_kind='status' then 'status_change' else 'assignment' end,v_text);
      end if;
    end if;
  end if;
  -- Free text and contact data are deliberately excluded from the audit event.
  perform private.write_admin_audit(v_actor,v_ticket.company_id,'support_ticket.'||p_kind,
    case when v_before.id is null then null else jsonb_build_object('ticket_id',v_before.id,'status',v_before.status,'revision',v_before.revision) end,
    jsonb_build_object('ticket_id',v_ticket.id,'status',v_ticket.status,'revision',v_ticket.revision,'operation_id',p_operation_id));
  v_result:=jsonb_build_object('ok',true,'ticket',to_jsonb(v_ticket),
    'note',case when v_note.id is null then null else to_jsonb(v_note) end);
  insert into private.admin_support_operations(actor_user_id,operation_id,kind,input,expected_revision,result)
    values(v_actor,p_operation_id,p_kind,p_input,p_expected_revision,v_result);
  return v_result;
end;
$$;
alter function public.admin_support_mutate(uuid,text,jsonb,bigint) owner to postgres;
revoke all on function public.admin_support_mutate(uuid,text,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_support_mutate(uuid,text,jsonb,bigint) to authenticated;
-- postgres-owned RPC only; no browser table writes, default grant reliance or service-role API.
commit;
