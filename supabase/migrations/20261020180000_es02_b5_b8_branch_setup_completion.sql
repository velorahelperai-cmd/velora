-- Filename: 20261020180000_es02_b5_b8_branch_setup_completion.sql
-- Additive B5, B6, B7, B8 branch-bound setup completion and launch verification.
-- Preserves B1, B2, B3, B4 production migrations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null then
    raise exception 'ES02_B5_B8_TRUSTED_OWNER_UNAVAILABLE';
  end if;
  -- Preserve the reviewed operational credit dependency and existing wrappers.
  if to_regclass('private.master_ai_credit_grants') is null
     or to_regclass('private.master_ai_reply_slots') is null
     or to_regclass('private.master_ai_cycles') is null then
    raise exception 'ES02_B5_B8_OPERATIONAL_CREDIT_BASELINE_MISSING'
      using hint = 'Install and verify the approved native credit foundation first; preserve current WhatsApp authorization wrappers.';
  end if;
  if to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regprocedure('public.es02_read_owned_branch_setup(uuid,uuid,uuid)') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null then
    raise exception 'ES02_B5_B8_BASELINE_MISSING';
  end if;
end;
$guard$;

create table if not exists private.es02_branch_knowledge_sources (
  company_id uuid not null,
  branch_id uuid not null,
  source_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (branch_id, source_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id),
  foreign key (source_id) references public.knowledge_sources (id) on delete cascade
);

alter table private.es02_branch_knowledge_sources owner to postgres;
alter table private.es02_branch_knowledge_sources enable row level security;
revoke all on table private.es02_branch_knowledge_sources from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_website_pages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  url text not null,
  title text,
  extracted_text text not null default '',
  status text not null default 'pending' check (status in ('pending','indexing','indexed','failed')),
  error text,
  version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  indexed_at timestamptz,
  unique (branch_id, url),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_website_pages owner to postgres;
alter table private.es02_branch_website_pages enable row level security;
revoke all on table private.es02_branch_website_pages from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_reply_language_confirmations (
  company_id uuid not null,
  branch_id uuid not null,
  reply_language text not null check (reply_language in ('ar','en','both')),
  revision bigint not null default 1,
  confirmed_at timestamptz not null default clock_timestamp(),
  primary key (company_id, branch_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_reply_language_confirmations owner to postgres;
alter table private.es02_branch_reply_language_confirmations enable row level security;
revoke all on table private.es02_branch_reply_language_confirmations from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_assistant_trials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  question text not null,
  answer text not null,
  origin text not null check (origin in ('engine','synthetic')),
  model_id text not null,
  hours_revision bigint not null default 0,
  language_code text not null default 'ar',
  persona text not null default 'noura',
  knowledge_revision text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_assistant_trials owner to postgres;
alter table private.es02_branch_assistant_trials enable row level security;
revoke all on table private.es02_branch_assistant_trials from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_launch_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  account_id uuid not null references auth.users (id),
  readiness_revision text not null,
  operation_id uuid not null,
  confirmed boolean not null check (confirmed = true),
  confirmed_at timestamptz not null default clock_timestamp(),
  unique (company_id, branch_id),
  unique (account_id, operation_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_launch_confirmations owner to postgres;
alter table private.es02_branch_launch_confirmations enable row level security;
revoke all on table private.es02_branch_launch_confirmations from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_reply_credit_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  account_id uuid not null references auth.users (id),
  operation_id uuid not null,
  deducted_kind text not null check (deducted_kind in ('purchased', 'base')),
  balance_id uuid not null references private.es02_credit_balances (id),
  remaining integer not null check (remaining >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, operation_id)
);

alter table private.es02_branch_reply_credit_receipts owner to postgres;
alter table private.es02_branch_reply_credit_receipts enable row level security;
revoke all on table private.es02_branch_reply_credit_receipts from public, anon, authenticated, service_role;

-- Source candidate only: native ACL/roles/concurrency acceptance remains NotRun.
alter table private.es02_branch_assistant_trials add column if not exists execution_id uuid;
create unique index if not exists es02_branch_trial_execution_unique
  on private.es02_branch_assistant_trials(company_id, branch_id, execution_id)
  where execution_id is not null;

-- One authoritative revision for BOTH indexed pages and currently approved knowledge.
create or replace function private.es02_branch_knowledge_revision(p_company_id uuid, p_branch_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with tokens as (
    select 'page:' || p.id::text || ':' || p.version::text || ':' || md5(coalesce(p.title,'') || ':' || p.url || ':' || p.extracted_text) as token
    from private.es02_branch_website_pages p
    where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> ''
    union all
    select 'source:' || k.id::text || ':' || k.content_version::text || ':' || md5(to_jsonb(k)::text)
    from public.knowledge_sources k
    where k.company_id = p_company_id and k.status = 'ready' and k.approved_for_answers = true
      and k.approved_version = k.content_version and btrim(k.content) <> ''
  ) select coalesce(md5(string_agg(token, ',' order by token)), 'no_knowledge') from tokens;
$$;
alter function private.es02_branch_knowledge_revision(uuid, uuid) owner to postgres;
revoke all on function private.es02_branch_knowledge_revision(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.es02_read_owned_branch_answer_context(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  authority jsonb;
  pages jsonb;
  page_count integer;
  page_chars bigint;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  select count(*), coalesce(sum(length(p.extracted_text) + length(coalesce(p.title,p.url)) + 6),0)
    into page_count, page_chars
  from private.es02_branch_website_pages p
  where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> '';
  if page_count > 40 or page_chars > 12000 then
    return jsonb_build_object('ok',false,'code','ANSWER_CONTEXT_OVERFLOW');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'url',p.url,'title',p.title,'extracted_text',p.extracted_text) order by p.id),'[]'::jsonb)
    into pages
  from private.es02_branch_website_pages p
  where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> '';
  return jsonb_build_object('ok',true,'data',jsonb_build_object('pages',pages,'knowledgeRevision',private.es02_branch_knowledge_revision(p_company_id,p_branch_id)));
end;
$$;
alter function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) to authenticated;

create or replace function public.es02_read_owned_branch_knowledge(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  branch public.company_branches%rowtype;
  entitlement jsonb;
  pkg text;
  quota_limit int := 10;
  quota_used int := 0;
  pages_arr jsonb := '[]'::jsonb;
  files_arr jsonb := '[]'::jsonb;
  faq_arr jsonb := '[]'::jsonb;
  pg record;
  src record;
  current_knowledge_rev text;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  entitlement := auth_check->'data';
  pkg := entitlement->>'package';
  if pkg = 'premium' then
    quota_limit := 50;
  else
    quota_limit := 10;
  end if;

  select count(*) into quota_used
  from private.es02_branch_website_pages
  where branch_id = p_branch_id;

  for pg in
    select id, url, title, status, error, version, length(extracted_text) as extracted_length
    from private.es02_branch_website_pages
    where branch_id = p_branch_id
    order by created_at desc
  loop
    pages_arr := pages_arr || jsonb_build_array(jsonb_build_object(
      'id', pg.id,
      'companyId', p_company_id,
      'branchId', p_branch_id,
      'version', pg.version,
      'url', pg.url,
      'title', pg.title,
      'status', case pg.status when 'indexed' then 'ready' when 'pending' then 'processing' when 'indexing' then 'processing' else 'failed' end,
      'error', pg.error,
      'extractedLength', pg.extracted_length,
      'capabilities', jsonb_build_object(
        'canRetry', pg.status = 'failed',
        'canRetrain', pg.status = 'indexed'
      )
    ));
  end loop;

  for src in
    select k.*
    from public.knowledge_sources k
    join private.es02_branch_knowledge_sources bks on bks.source_id = k.id
    where bks.branch_id = p_branch_id and k.company_id = p_company_id
    order by k.created_at desc
  loop
    if src.kind = 'file' then
      files_arr := files_arr || jsonb_build_array(jsonb_build_object(
        'branchId', p_branch_id,
        'source', to_jsonb(src)
      ));
    else
      faq_arr := faq_arr || jsonb_build_array(jsonb_build_object(
        'branchId', p_branch_id,
        'source', to_jsonb(src)
      ));
    end if;
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'websiteQuota', jsonb_build_object('limit', quota_limit, 'used', quota_used),
        'pages', pages_arr,
        'files', files_arr,
        'faq', faq_arr,
        'capabilities', jsonb_build_object(
          'canAddWebsite', quota_used < quota_limit,
          'canUploadFiles', true,
          'canSaveText', true
        )
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_add_owned_branch_website(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version int,
  p_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  entitlement jsonb;
  pkg text;
  quota_limit int := 10;
  quota_used int := 0;
  page_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or nullif(trim(p_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  -- Lock branch row to serialize concurrent website additions and CAS check
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  entitlement := auth_check->'data';
  pkg := entitlement->>'package';
  if pkg = 'premium' then
    quota_limit := 50;
  else
    quota_limit := 10;
  end if;

  select count(*) into quota_used
  from private.es02_branch_website_pages
  where branch_id = p_branch_id;

  if quota_used >= quota_limit then
    return jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED');
  end if;

  -- Stored with 'pending' status (never immediately 'ready' before extraction/indexing)
  insert into private.es02_branch_website_pages (company_id, branch_id, url, status)
  values (p_company_id, p_branch_id, trim(p_url), 'pending')
  on conflict (branch_id, url)
  do update set updated_at = clock_timestamp(), version = private.es02_branch_website_pages.version + 1, status = 'pending', error = null
  returning id into page_id;

  -- Invalidate any prior launch confirmation if knowledge changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_page_action_owned_branch_knowledge(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_page_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null or p_action not in ('retry', 'retrain') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  update private.es02_branch_website_pages
  set status = 'pending', error = null, updated_at = clock_timestamp(), version = version + 1
  where id = p_page_id and branch_id = p_branch_id and company_id = p_company_id;

  -- Invalidate any prior launch confirmation if knowledge changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_read_owned_branch_reply_language(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  company public.companies%rowtype;
  branch public.company_branches%rowtype;
  conf_row private.es02_branch_reply_language_confirmations%rowtype;
  conf_state text := 'unconfirmed';
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into company from public.companies where id = p_company_id;
  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;

  select * into conf_row
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  if conf_row.company_id is not null then
    conf_state := 'confirmed';
  else
    conf_state := 'unconfirmed';
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', coalesce(conf_row.revision, 1),
        'companyLabel', coalesce(company.display_name, company.name, 'Velora Business'),
        'branchLabel', branch.name,
        'replyLanguage', coalesce(conf_row.reply_language, company.reply_language, 'both'),
        'confirmation', conf_state,
        'canConfirm', true
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_confirm_owned_branch_reply_language(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_reply_language text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  current_rev bigint;
  next_rev bigint;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_reply_language not in ('ar', 'en', 'both') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select revision into current_rev
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id
  for update;

  if current_rev is not null and p_expected_version is not null and current_rev <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  next_rev := coalesce(current_rev, 0) + 1;

  insert into private.es02_branch_reply_language_confirmations (company_id, branch_id, reply_language, revision, confirmed_at)
  values (p_company_id, p_branch_id, p_reply_language, next_rev, clock_timestamp())
  on conflict (company_id, branch_id)
  do update set reply_language = excluded.reply_language, revision = excluded.revision, confirmed_at = excluded.confirmed_at;

  update public.companies set reply_language = p_reply_language where id = p_company_id;

  -- Invalidate any prior launch confirmation if language confirmed/changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_reply_language(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Ten lifetime setup replies per branch. AI spend remains in the existing ledger/budget.
alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_usage_mode_check;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_usage_mode_check check(usage_mode in ('admin_test','company_live','setup_trial'));
create table if not exists private.es02_branch_trial_operations (
  operation_id uuid primary key references public.ai_usage_ledger(id),
  company_id uuid not null, branch_id uuid not null, account_id uuid not null references auth.users(id),
  native_session_id uuid not null references auth.sessions(id),
  question_hash text not null, knowledge_revision text not null, hours_revision bigint not null,
  language_code text not null, persona text not null, model_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
alter table private.es02_branch_trial_operations owner to postgres;
alter table private.es02_branch_trial_operations enable row level security;
revoke all on private.es02_branch_trial_operations from public,anon,authenticated,service_role;
create index if not exists es02_trial_branch_allowance on private.es02_branch_trial_operations(company_id,branch_id);

create or replace function private.es02_trial_context_current(op private.es02_branch_trial_operations)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.company_members m
    join public.companies c on c.id=m.company_id
    join public.company_branches b on b.company_id=c.id
    join private.es02_branch_slot_rights r on r.branch_id=b.id and r.company_id=c.id
    join private.es02_account_orders o on o.id=r.order_id and o.account_id=op.account_id
    join private.es02_branch_hours h on h.company_id=c.id and h.branch_id=b.id
    join private.es02_branch_reply_language_confirmations lang on lang.company_id=c.id and lang.branch_id=b.id
    where m.user_id=op.account_id and m.company_id=op.company_id and b.id=op.branch_id
      and m.role='owner' and m.status='active' and c.status in ('setup','active') and b.status='setup'
      and o.status='provisioned' and o.provisioned_company_id=op.company_id and private.es02_order_catalog_consistent(o)
      and op.persona=case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
      and op.hours_revision=h.revision and op.language_code=lang.reply_language
      and op.knowledge_revision=private.es02_branch_knowledge_revision(op.company_id,op.branch_id)
  ) and private.es02_b3_session_open(op.account_id,op.native_session_id);
$$;
alter function private.es02_trial_context_current(private.es02_branch_trial_operations) owner to postgres;
revoke all on function private.es02_trial_context_current(private.es02_branch_trial_operations) from public,anon,authenticated,service_role;

create or replace function public.es02_reserve_branch_trial(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; budget public.ai_budget_accounts; used integer; state text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_operation_id is null or p_session_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
     or p_model_id<>'gemini-3.8-flash' or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
     or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
     or jsonb_typeof(p_source_citations) is distinct from 'array' or jsonb_array_length(p_source_citations)>40 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same global budget-first lock order as existing reserve/start/settle/reconcile.
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  if op.operation_id is not null then
    if op.account_id<>p_account_id or op.company_id<>p_company_id or op.branch_id<>p_branch_id or op.question_hash<>md5(btrim(p_question)) then
      return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');
    end if;
    select status into state from public.ai_usage_ledger where id=op.operation_id;
    return jsonb_build_object('ok',true,'newlyReserved',false,'state',state,'operationId',p_operation_id);
  end if;
  op.operation_id:=p_operation_id;op.company_id:=p_company_id;op.branch_id:=p_branch_id;op.account_id:=p_account_id;
  op.native_session_id:=p_session_id;op.question_hash:=md5(btrim(p_question));op.knowledge_revision:=p_knowledge_revision;
  op.hours_revision:=p_hours_revision;op.language_code:=p_language_code;op.persona:=p_persona;op.model_id:=p_model_id;
  if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED'); end if;
  if exists(select 1 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status<>'rejected';
  if used>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp());
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',9-used);
end;
$$;

create or replace function public.es02_start_branch_trial(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; entry public.ai_usage_ledger; budget public.ai_budget_accounts;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  select * into entry from public.ai_usage_ledger where id=p_operation_id;
  if op.operation_id is null or entry.usage_mode is distinct from 'setup_trial' then return jsonb_build_object('ok',false,'code','NOT_RESERVED'); end if;
  select * into budget from public.ai_budget_accounts where id=entry.budget_account_id for update;
  perform 1 from public.company_branches where company_id=op.company_id and id=op.branch_id for update;
  select * into entry from public.ai_usage_ledger where id=p_operation_id for update;
  if not budget.enabled or budget.spent_baisa+budget.held_baisa>least(budget.limit_baisa,1000) or not private.es02_trial_context_current(op) then
    return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED');
  end if;
  if entry.status<>'reserved' then return jsonb_build_object('ok',false,'code','TRIAL_PENDING'); end if;
  update public.ai_usage_ledger set status='running' where id=p_operation_id;
  return jsonb_build_object('ok',true);
end;
$$;
alter function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) owner to postgres;
revoke all on function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) to service_role;
alter function public.es02_start_branch_trial(uuid) owner to postgres;
revoke all on function public.es02_start_branch_trial(uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_start_branch_trial(uuid) to service_role;

-- Reuse the existing immutable cost settlement and unknown-outcome holds.
do $settlement$
declare definition text;
begin
  definition:=pg_get_functiondef('private.ai_settle_admin(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text,boolean)'::regprocedure);
  if position('entry.usage_mode<>''admin_test''' in definition)>0 then
    definition:=replace(definition,'entry.usage_mode<>''admin_test''','entry.usage_mode not in (''admin_test'',''setup_trial'')');
    execute definition;
  elsif position('''setup_trial''' in definition)=0 then raise exception 'SETUP_TRIAL_SETTLEMENT_BASELINE_CHANGED'; end if;
end;
$settlement$;

create or replace function public.es02_read_owned_branch_assistant_trial(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority jsonb;
  is_member boolean;
  branch public.company_branches%rowtype;
  company public.companies%rowtype;
  messages_arr jsonb := '[]'::jsonb;
  t_row record;
  current_knowledge_rev text;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  select * into company from public.companies where id = p_company_id;

  for t_row in
    select id, question, answer, origin, model_id, hours_revision, language_code, persona, knowledge_revision, execution_id, created_at
    from private.es02_branch_assistant_trials
    where company_id = p_company_id and branch_id = p_branch_id
    order by created_at asc
    limit 20
  loop
    messages_arr := messages_arr || jsonb_build_array(jsonb_build_object(
      'id', t_row.id,
      'executionId', t_row.execution_id,
      'scope', jsonb_build_object(
        'expectedAccountId', p_expected_account_id,
        'companyId', p_company_id,
        'branchId', p_branch_id
      ),
      'version', 1,
      'knowledgeRevision', t_row.knowledge_revision,
      'hoursRevision', t_row.hours_revision,
      'languageCode', t_row.language_code,
      'persona', t_row.persona,
      'question', t_row.question,
      'origin', t_row.origin,
      'result', jsonb_build_object(
        'ok', true,
        'text', t_row.answer,
        'modelId', t_row.model_id,
        'citations', coalesce((select l.source_citations from public.ai_usage_ledger l where l.id=t_row.execution_id),'[]'::jsonb)
      )
    ));
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'businessType', coalesce(company.business_type, 'retail'),
        'canAsk', branch.status='setup' and
          (select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status<>'rejected')<10 and
          not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')),
        'trialAllowance', jsonb_build_object('limit',10,'used',(select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status<>'rejected')),
        'messages', messages_arr
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Trusted server writer only. The end-user RPC role cannot manufacture engine proof.
create or replace function public.es02_record_owned_branch_assistant_trial(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid,
  p_question text, p_answer text, p_model_id text,
  p_hours_revision bigint, p_language_code text, p_persona text,
  p_knowledge_revision text, p_execution_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  trusted_persona text;
  current_hours bigint;
  current_language text;
  receipt uuid;
begin
  if p_execution_id is null or nullif(btrim(p_question),'') is null or nullif(btrim(p_answer),'') is null or nullif(btrim(p_model_id),'') is null then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id
    where op.operation_id=p_execution_id and op.company_id=p_company_id and op.branch_id=p_branch_id and op.account_id=p_expected_account_id
      and op.question_hash=md5(btrim(p_question)) and op.model_id=p_model_id and op.persona=p_persona
      and op.knowledge_revision=p_knowledge_revision and op.hours_revision=p_hours_revision and op.language_code=p_language_code
      and l.usage_mode='setup_trial' and l.status='success') then
    return jsonb_build_object('ok',false,'code','VERIFIED_EXECUTION_REQUIRED');
  end if;
  -- The server re-attests the native actor before this service-only call.
  -- Lock/recheck the tenant, paid branch, profile and context before accepting proof.
  perform 1 from public.company_branches b join public.companies c on c.id=b.company_id
    join public.company_members m on m.company_id=c.id
    where b.company_id=p_company_id and b.id=p_branch_id and m.user_id=p_expected_account_id
      and m.status='active' and m.role='owner' and b.status in ('setup','active') and c.status in ('setup','active')
    for update of b,c,m;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
    into trusted_persona from private.es02_branch_slot_rights r
    where r.company_id=p_company_id and r.branch_id=p_branch_id for share;
  select revision into current_hours from private.es02_branch_hours where company_id=p_company_id and branch_id=p_branch_id for share;
  select reply_language into current_language from private.es02_branch_reply_language_confirmations where company_id=p_company_id and branch_id=p_branch_id for share;
  if trusted_persona is null or trusted_persona is distinct from p_persona or current_hours is distinct from p_hours_revision
     or current_language is distinct from p_language_code
     or private.es02_branch_knowledge_revision(p_company_id,p_branch_id) is distinct from p_knowledge_revision then
    return jsonb_build_object('ok',false,'code','CONTEXT_CHANGED');
  end if;
  insert into private.es02_branch_assistant_trials(company_id,branch_id,question,answer,origin,model_id,hours_revision,language_code,persona,knowledge_revision,execution_id)
    values(p_company_id,p_branch_id,btrim(p_question),btrim(p_answer),'engine',p_model_id,p_hours_revision,p_language_code,p_persona,p_knowledge_revision,p_execution_id)
    on conflict(company_id,branch_id,execution_id) where execution_id is not null do nothing
    returning id into receipt;
  if receipt is null then
    select id into receipt from private.es02_branch_assistant_trials
      where company_id=p_company_id and branch_id=p_branch_id and execution_id=p_execution_id
        and question=btrim(p_question) and answer=btrim(p_answer) and model_id=p_model_id and persona=p_persona
        and hours_revision=p_hours_revision and language_code=p_language_code and knowledge_revision=p_knowledge_revision;
    if receipt is null then return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT'); end if;
  end if;
  return jsonb_build_object('ok',true,'receiptId',receipt,'executionId',p_execution_id);
end;
$$;

create or replace function public.es02_read_owned_branch_launch_summary(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_member boolean;
  sel_channels jsonb;
  auth_check jsonb;
  branch public.company_branches%rowtype;
  conf_launch private.es02_branch_launch_confirmations%rowtype;
  conf_lang private.es02_branch_reply_language_confirmations%rowtype;
  hours_rev bigint := 0;
  lang_rev bigint := 0;
  knowledge_count int := 0;
  current_knowledge_rev text := 'no_pages';
  has_hours boolean := false;
  has_knowledge boolean := false;
  has_language boolean := false;
  has_trial boolean := false;
  has_ch_verified boolean := false;
  hours_status text := 'pending';
  knowledge_status text := 'pending';
  language_status text := 'pending';
  blockers text[] := array[]::text[];
  readiness_status text := 'ready';
  readiness_rev text := 'rev_0';
  op_id uuid := gen_random_uuid();
  ch_arr jsonb := '[]'::jsonb;
  ch text;
  ch_proof_summary text;
  channel_snapshot jsonb;
  channel_proofs jsonb := '[]'::jsonb;
  latest_trial_row record;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Caller session check
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select channels into sel_channels
  from private.es02_branch_channel_selections
  where company_id = p_company_id and branch_id = p_branch_id;
  if sel_channels is null then
    sel_channels := coalesce(auth_check->'data'->'selectedChannels', '["whatsapp"]'::jsonb);
  end if;

  select * into conf_launch
  from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  select coalesce(revision, 0) into hours_rev
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_branch_id;
  has_hours := (hours_rev > 0);

  select * into conf_lang
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;
  lang_rev := coalesce(conf_lang.revision, 0);
  has_language := (lang_rev > 0);

  -- Compute deterministic revision of approved / indexed knowledge for this branch
  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  select count(*) into knowledge_count
  from private.es02_branch_website_pages
  where branch_id = p_branch_id and status = 'indexed';

  -- Only approved / ready / indexed knowledge counts
  select exists (
    select 1 from private.es02_branch_website_pages p
    where p.branch_id = p_branch_id and p.status = 'indexed' and p.extracted_text <> ''
    union
    select 1 from private.es02_branch_knowledge_sources bks
    join public.knowledge_sources ks on ks.id = bks.source_id
    where bks.branch_id = p_branch_id and ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
    union
    select 1 from public.knowledge_sources ks
    where ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
  ) into has_knowledge;

  -- Verified assistant trial required: must be from genuine engine and match current hours, language, and knowledge
  select exists (
    select 1 from private.es02_branch_assistant_trials t
    where t.company_id = p_company_id
      and t.branch_id = p_branch_id
      and t.origin = 'engine' and t.execution_id is not null
      and t.hours_revision = hours_rev
      and (lang_rev = 0 or t.language_code = coalesce(conf_lang.reply_language, 'both'))
      and t.knowledge_revision = current_knowledge_rev
      and t.persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  ) into has_trial;

  hours_status := case when has_hours then 'verified' else 'pending' end;
  knowledge_status := case when has_knowledge then 'verified' else 'pending' end;
  language_status := case when has_language then 'verified' else 'pending' end;

  if not has_hours then
    blockers := array_append(blockers, 'hours_incomplete');
  end if;
  if not has_knowledge then
    blockers := array_append(blockers, 'knowledge_incomplete');
  end if;
  if not has_language then
    blockers := array_append(blockers, 'language_unconfirmed');
  end if;
  if not has_trial then
    blockers := array_append(blockers, 'trial_incomplete');
  end if;

  -- Channel verification requires actual B3 branch connection link proof
  for ch in select jsonb_array_elements_text(sel_channels) loop
    has_ch_verified := false;
    channel_snapshot := public.es02_b3_read_owned_branch_connection(p_expected_account_id,p_company_id,p_branch_id,ch);
    has_ch_verified := channel_snapshot->>'sourceStatus' = 'ready'
      and channel_snapshot->'connection'->>'state' = 'connected'
      and channel_snapshot->'connection'->>'verified' = 'true';
    channel_proofs := channel_proofs || jsonb_build_array(channel_snapshot - 'asOf');

    if has_ch_verified is distinct from true then
      blockers := array_append(blockers, 'channel_unverified:' || ch);
    end if;

    ch_arr := ch_arr || jsonb_build_array(jsonb_build_object(
      'channel', ch,
      'detail', case when has_ch_verified then 'تم إثبات الربط والصلاحيات للفرع' else 'بانتظار اكتمال ربط القناة للفرع' end,
      'status', case when has_ch_verified then 'verified' else 'pending' end
    ));
  end loop;

  if cardinality(blockers) > 0 then
    readiness_status := 'blocked';
  else
    readiness_status := 'ready';
  end if;

  select string_agg(l.id::text || ':' || coalesce(l.legacy_generation, 0)::text, ',' order by l.channel)
  into ch_proof_summary
  from private.es02_b3_connection_links l
  where l.branch_id = p_branch_id and l.company_id = p_company_id and l.status = 'active' and l.revoked_at is null;

  select id, created_at, model_id, persona into latest_trial_row
  from private.es02_branch_assistant_trials
  where company_id = p_company_id and branch_id = p_branch_id and origin = 'engine'
    and hours_revision = hours_rev
    and (lang_rev = 0 or language_code = coalesce(conf_lang.reply_language, 'both'))
    and knowledge_revision = current_knowledge_rev
    and execution_id is not null
    and persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  order by created_at desc limit 1;

  -- Dynamic readiness revision fingerprint
  readiness_rev := md5(concat_ws(':',
    p_company_id::text,
    p_branch_id::text,
    hours_rev::text,
    lang_rev::text,
    current_knowledge_rev,
    ((auth_check->'data') - 'asOf')::text,
    sel_channels::text,
    channel_proofs::text,
    coalesce(ch_proof_summary, 'none'),
    coalesce(latest_trial_row.id::text, 'no_trial'),
    coalesce(latest_trial_row.model_id, 'no_model'),
    coalesce(latest_trial_row.persona, 'no_persona'),
    cardinality(blockers)::text
  ));

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'branchLabel', branch.name,
        'setup', jsonb_build_object(
          'companyId', p_company_id,
          'selectedBranchId', p_branch_id,
          'sourceStatus', auth_check->'data'->>'sourceStatus',
          'selectedChannels', auth_check->'data'->'selectedChannels',
          'entitlement', auth_check->'data'->'entitlement',
          'launch', jsonb_build_object(
            'confirmationRequired', true,
            'confirmed', conf_launch.id is not null,
            'canRequest', readiness_status = 'ready',
            'blockedReasons', to_jsonb(blockers)
          )
        ),
        'readiness', jsonb_build_object(
          'status', readiness_status,
          'revision', readiness_rev,
          'blockers', to_jsonb(blockers)
        ),
        'summary', jsonb_build_object(
          'channels', ch_arr,
          'hours', jsonb_build_object('detail', case when has_hours then 'مكتملة ومحفوظة' else 'غير مكتملة' end, 'status', hours_status),
          'knowledge', jsonb_build_object('detail', case when has_knowledge then 'مصادر معرفة معتمدة' else 'بانتظار إضافة المعرفة' end, 'status', knowledge_status),
          'persona', jsonb_build_object('detail', 'نورا', 'status', 'verified'),
          'team', jsonb_build_object('detail', 'دعوة الموظفين مؤجلة بقرار المالك', 'status', 'deferred')
        ),
        'operationId', op_id,
        'activation', jsonb_build_object(
          'status', case when conf_launch.id is not null then 'launched' else 'not_started' end,
          'receiptId', conf_launch.id,
          'operationId', conf_launch.operation_id
        )
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_confirm_owned_branch_launch(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_readiness_revision text,
  p_operation_id uuid,
  p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary jsonb;
  current_readiness_rev text;
  receipt_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_operation_id is null or p_confirmed is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Caller session identity guard
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- Lock branch row to serialize concurrent launch confirmations
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  summary := public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
  if summary->>'ok' is distinct from 'true' then
    return summary;
  end if;

  if summary->'data'->'snapshot'->'readiness'->>'status' is distinct from 'ready' then
    return jsonb_build_object('ok', false, 'code', 'READINESS_INCOMPLETE', 'blockers', summary->'data'->'snapshot'->'readiness'->'blockers');
  end if;

  current_readiness_rev := summary->'data'->'snapshot'->'readiness'->>'revision';
  if p_readiness_revision is distinct from current_readiness_rev then
    return jsonb_build_object('ok', false, 'code', 'READINESS_CHANGED', 'currentRevision', current_readiness_rev);
  end if;

  insert into private.es02_branch_launch_confirmations (company_id, branch_id, account_id, readiness_revision, operation_id, confirmed)
  values (p_company_id, p_branch_id, p_expected_account_id, p_readiness_revision, p_operation_id, true)
  on conflict (company_id, branch_id)
  do update set confirmed = true, confirmed_at = clock_timestamp(), readiness_revision = excluded.readiness_revision
  returning id into receipt_id;

  -- Activate branch and company if still in setup
  update public.company_branches set status = 'active' where company_id = p_company_id and id = p_branch_id and status = 'setup';
  perform set_config('velora.allow_status_change', 'on', true);
  update public.companies set status = 'active' where id = p_company_id and status = 'setup';

  return public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_atomic_deduct_reply_credit(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt_row private.es02_branch_reply_credit_receipts%rowtype;
  row_rec record;
  deducted_kind text;
  new_remaining integer;
begin
  if p_expected_account_id is null or p_company_id is null or p_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- 1. Session identity guard: when called via authenticated PostgREST API, auth.uid() must match p_expected_account_id
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- 2. Check membership / tenancy authorization
  perform 1 from public.company_members m
  where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- 3. Idempotency receipt check: if this operation_id was already processed, return existing receipt
  select * into receipt_row
  from private.es02_branch_reply_credit_receipts
  where company_id = p_company_id and operation_id = p_operation_id;

  if receipt_row.id is not null then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'deductedFrom', receipt_row.deducted_kind,
      'remaining', receipt_row.remaining
    );
  end if;

  -- 4. Try purchased add-on credits first (lock row for update)
  select * into row_rec
  from private.es02_credit_balances
  where company_id = p_company_id
    and kind = 'purchased'
    and remaining > 0
    and (ordinary_expiry is null or ordinary_expiry > clock_timestamp())
  order by created_at asc
  limit 1
  for update;

  if row_rec.id is not null then
    deducted_kind := 'purchased';
    new_remaining := row_rec.remaining - 1;
    update private.es02_credit_balances
    set remaining = new_remaining
    where id = row_rec.id;

    insert into private.es02_branch_reply_credit_receipts (
      company_id, account_id, operation_id, deducted_kind, balance_id, remaining
    ) values (
      p_company_id, p_expected_account_id, p_operation_id, 'purchased', row_rec.id, new_remaining
    );

    return jsonb_build_object('ok', true, 'replayed', false, 'deductedFrom', 'purchased', 'remaining', new_remaining);
  end if;

  -- 5. Try base package allowance
  select * into row_rec
  from private.es02_credit_balances
  where company_id = p_company_id
    and kind = 'base'
    and remaining > 0
    and (ordinary_expiry is null or ordinary_expiry > clock_timestamp())
  order by created_at asc
  limit 1
  for update;

  if row_rec.id is not null then
    deducted_kind := 'base';
    new_remaining := row_rec.remaining - 1;
    update private.es02_credit_balances
    set remaining = new_remaining
    where id = row_rec.id;

    insert into private.es02_branch_reply_credit_receipts (
      company_id, account_id, operation_id, deducted_kind, balance_id, remaining
    ) values (
      p_company_id, p_expected_account_id, p_operation_id, 'base', row_rec.id, new_remaining
    );

    return jsonb_build_object('ok', true, 'replayed', false, 'deductedFrom', 'base', 'remaining', new_remaining);
  end if;

  -- 6. No credits remaining: do not allow negative balance, signal transfer to staff
  return jsonb_build_object(
    'ok', false,
    'code', 'CREDITS_EXHAUSTED',
    'transferToStaff', true,
    'message', 'Credit limit reached. Transfer to staff requested.'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_index_branch_website_page(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_page_id uuid,
  p_title text,
  p_extracted_text text,
  p_status text,
  p_error text,
  p_expected_version integer,
  p_expected_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null or p_status not in ('indexed', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  update private.es02_branch_website_pages
  set title = coalesce(p_title, title),
      extracted_text = case when p_status = 'indexed' then coalesce(p_extracted_text, '') else extracted_text end,
      status = p_status,
      error = case when p_status = 'failed' then coalesce(p_error, 'Extraction failed') else null end,
      indexed_at = case when p_status = 'indexed' then clock_timestamp() else indexed_at end,
      updated_at = clock_timestamp(),
      version = version + 1
  where id = p_page_id and branch_id = p_branch_id and company_id = p_company_id
     and version=p_expected_version and url=p_expected_url;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAGE_CHANGED');
  end if;

  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Prior local signatures must not retain authenticated EXECUTE after an upgrade.
do $acl$
declare target regprocedure;
begin
  for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('es02_record_owned_branch_assistant_trial','es02_index_branch_website_page')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',target);
  end loop;
end;
$acl$;

-- Explicit ownership and execution permissions for all public functions
alter function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) to authenticated;

alter function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) owner to postgres;
revoke all on function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) from public, anon;
grant execute on function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) to authenticated;

alter function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) owner to postgres;
revoke all on function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) to authenticated;

alter function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) to authenticated;

alter function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) owner to postgres;
revoke all on function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) from public, anon;
grant execute on function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) to authenticated;

alter function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) to authenticated;

alter function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) owner to postgres;
revoke all on function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) from public, anon;
grant execute on function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) to service_role;

alter function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) owner to postgres;
revoke all on function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) from public, anon;
grant execute on function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) to authenticated;

alter function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) to authenticated;

alter function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) owner to postgres;
revoke all on function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) from public, anon;
grant execute on function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) to authenticated;

alter function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) from public, anon;
revoke all on function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) from authenticated, service_role;
-- Legacy account-only debit is retired; workers use the existing claimed capacity/cost RPC.

-- Change only the grant ordering in the existing operational ledger. Expiry,
-- carryover, claim checks, holds and settlement remain unchanged.
do $priority$
declare
  definition text;
  source_hash text;
  target oid := to_regprocedure('public.whatsapp_reserve_job_usage(uuid,uuid)');
begin
  -- A wrapped or unknown implementation must not be rewritten by substring.
  select md5(replace(p.prosrc, E'\r\n', E'\n')) into source_hash
  from pg_catalog.pg_proc p
  where p.oid = target
    and p.proowner = to_regrole('postgres')
    and p.prosecdef
    and to_regrole('service_role') is not null
    and pg_get_function_result(p.oid) = 'jsonb'
    and 'search_path=""' = any(coalesce(p.proconfig, array[]::text[]))
    and not exists (
      select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and (a.grantee not in (p.proowner, to_regrole('service_role')::oid)
          or (a.grantee <> p.proowner and a.is_grantable))
    );
  if source_hash is null or source_hash not in (
    '020c89f9181499d8fd3cf83346ceb0fb',
    '88e06bb8fdd5091ad12106814ff7c370'
  ) then
    raise exception 'OPERATIONAL_REPLY_CREDIT_PRIORITY_BASELINE_CHANGED'
      using hint = 'Unsupported native reservation body or authority; preserve wrappers and review the actual credit implementation.';
  end if;
  definition := pg_get_functiondef(target);
  if position('case g.kind when ''base'' then 0 when ''topup'' then 1 else 2 end' in definition)>0 then
    definition:=replace(definition,'case g.kind when ''base'' then 0 when ''topup'' then 1 else 2 end','case g.kind when ''topup'' then 0 when ''base'' then 1 else 2 end');
    execute definition;
  elsif position('case g.kind when ''topup'' then 0 when ''base'' then 1 else 2 end' in definition)=0 then
    raise exception 'OPERATIONAL_REPLY_CREDIT_PRIORITY_BASELINE_CHANGED';
  end if;
end;
$priority$;

commit;
