"""Rollback-only native RPC authorization probe on the existing isolated fixture."""
from pathlib import Path
import subprocess
from preserve import ROOT

subprocess.run(['node','scripts/consolidation/guard.mjs'],cwd=ROOT,check=True)
container='velora-es02-b3-postgres-2964b85e'
pinned='5b73e1a917e27a0cbe0debc652e2a301cbaf7dba3c567d37f66f2886026ca537'
actual=subprocess.check_output(['docker','inspect','--format','{{.Id}}',container],text=True).strip()
assert actual==pinned,'Wrong local container'
migration=(ROOT/'supabase/migrations/20261022090000_admin_list_companies_pagination_review.sql').read_text(encoding='utf-8')
sql="""begin;
set local statement_timeout='20s';
do $guard$ begin if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED'; end if; end $guard$;
"""+migration+"""
do $actor$
declare actor uuid;
begin
 select user_id into strict actor from public.platform_admins where role='owner' and status='active';
 perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated','session_id',gen_random_uuid())::text,true);
end $actor$;
set local role authenticated;
do $probe$
declare result jsonb; denied boolean:=false;
begin
 begin result:=public.admin_list_companies_page('', 'all', 1, 0);
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'ADMIN_RPC_ACCEPTED_INVALID_NATIVE_SESSION'; end if;
 raise notice 'PASS:invalid_native_session_denied';
 denied:=false;
 begin perform 1 from public.admin_list_companies('');
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'LEGACY_ADMIN_RPC_ACCEPTED_INVALID_NATIVE_SESSION'; end if;
 raise notice 'PASS:legacy_invalid_native_session_denied';
end $probe$;
rollback;
"""
r=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','c1_ui_integration','-v','ON_ERROR_STOP=1'],input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
output=ROOT/'.git/velora-consolidation-20261022/admin-rpc-probe.log'
output.write_bytes(r.stdout)
print(f'NATIVE_RPC_PROBE_EXIT={r.returncode}; transaction connection closed; no commit')
print(r.stdout.decode(errors='replace')[-1800:])
raise SystemExit(r.returncode)
