# Deterministic local preparation ONLY. No DB connection or SQL execution.
import hashlib,json,sys
from pathlib import Path
SQL_SHA="2374838776ea6055c32807dbddcca22ee2459563e8946f592e345176de921d83"
WRAPPER_SHA="1444494ebbfd9458e18bfc9ce7759eed280a1f7550290a9e7309dcfabd79e516"
PREFIX=b"-- PREPARED ONLY. Run ONLY through the existing TLS-verified postgres connection\n-- with psql -X --no-password -v ON_ERROR_STOP=1 -v ON_ERROR_ROLLBACK=off --single-transaction --file this-file.\n-- No explicit transaction-control commands belong in this file.\nset local lock_timeout='5s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='30s';\nset local search_path='';\ndo $invitation_guard$\nbegin\n if current_user<>'postgres' or current_database()<>'postgres' then raise exception 'INVITATION_WRONG_OPERATOR_OR_DATABASE';end if;\n if exists(select 1 from supabase_migrations.schema_migrations where version='20261011160000')\n or to_regclass('private.staff_invitation_recipients') is not null\n or to_regclass('private.staff_invitation_operations') is not null\n or to_regprocedure('private.staff_invitation_projection(uuid)') is not null\n or to_regprocedure('public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)') is not null\n then raise exception 'INVITATION_ALREADY_OR_PARTIALLY_INSTALLED';end if;\n if exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('private.staff_invitations') and not attisdropped and attname in ('cancelled_at','cancelled_by','superseded_by','legacy_duplicate'))\n then raise exception 'INVITATION_COLUMN_COLLISION';end if;\n if exists(select 1 from (values\n('private.staff_invitation_actor(boolean)','5226c121c788d403864720285661d429'),\n('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)','4808bed3a919f923e9fe409cb8a30699'),\n('public.create_staff_invitation(uuid,text,text,text)','17a3eee91f8abd8e1d9ee3a25d3a4351'),\n('public.read_staff_invitation(text)','54651a6e109e922f85cc4e7b09931714'),\n('public.accept_staff_invitation(text)','b0bd645a2d58a14295f3522c56535753'),\n('public.list_company_team(uuid)','4be5fdb04ff38b3135b7a63a3c577b25')\n )v(signature,pin) left join pg_catalog.pg_proc p on p.oid=to_regprocedure(v.signature)\n where p.oid is null or md5(pg_get_functiondef(p.oid))<>v.pin)\n then raise exception 'INVITATION_BASELINE_FUNCTION_DRIFT';end if;\nend;\n$invitation_guard$;\n"
MIDDLE=b"\n-- Same psql transaction: exact reviewed source stored as the sole history statement.\ninsert into supabase_migrations.schema_migrations(version,name,statements) values\n('20261011160000','velora_staff_invitation_recovery_23748387',array[$invitation_source$"
SUFFIX=b'$invitation_source$]);\n'
def main():
    if len(sys.argv)!=3:raise SystemExit("Usage: python build-invitation-installer.py VERIFIED_SQL_PATH OUTPUT_WRAPPER_PATH")
    source=Path(sys.argv[1]);target=Path(sys.argv[2])
    if source.is_symlink() or target.is_symlink():raise SystemExit("Symlink paths refused")
    sql=source.read_bytes()
    if hashlib.sha256(sql).hexdigest()!=SQL_SHA:raise SystemExit("Original SQL byte hash mismatch; no normalization or output write")
    wrapper=PREFIX+sql+MIDDLE+sql+SUFFIX
    if len(wrapper)!=38810 or hashlib.sha256(wrapper).hexdigest()!=WRAPPER_SHA:raise SystemExit("Wrapper byte hash mismatch; no output write")
    if target.exists():
        if target.read_bytes()!=wrapper:raise SystemExit("Existing output differs; no overwrite")
    else:
        with target.open("xb") as file:file.write(wrapper)
    actual=hashlib.sha256(target.read_bytes()).hexdigest()
    if actual!=WRAPPER_SHA:raise SystemExit("Written wrapper verification failed")
    print(json.dumps({"sqlSha256":SQL_SHA,"wrapperSha256":actual,"wrapperBytes":len(wrapper),"SQLExecuted":False}))
if __name__=="__main__":main()
