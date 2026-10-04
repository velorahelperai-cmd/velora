-- VEL-006B: file text preparation status and supported document types

alter table public.knowledge_sources
  add column if not exists failure_code text;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint as con
    join pg_class as rel on rel.oid = con.conrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'knowledge_sources'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
      and pg_get_constraintdef(con.oid) not ilike '%storage_path%'
      and pg_get_constraintdef(con.oid) not ilike '%file_name%'
  loop
    execute format('alter table public.knowledge_sources drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.knowledge_sources
  drop constraint if exists knowledge_sources_status_check;

alter table public.knowledge_sources
  add constraint knowledge_sources_status_check
  check (status in ('draft', 'stored', 'processing', 'ready', 'failed'));

alter table public.knowledge_sources
  drop constraint if exists knowledge_sources_failure_code_chk;

alter table public.knowledge_sources
  add constraint knowledge_sources_failure_code_chk
  check (
    failure_code is null
    or failure_code in ('no_text', 'corrupt', 'unsupported', 'extract_failed')
  );

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'company-knowledge';
