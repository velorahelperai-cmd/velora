-- Preserve installed payment, scope and launch guards. Only disambiguate the
-- local persona variable from ai_usage_ledger.persona (Postgres error 42702).
do $migration$
declare original text; patched text; old_frag text; new_frag text; i integer;
 old_fragments text[] := array['persona text;', 'persona:=case r.persona', 't.persona=persona', '''persona'',persona,'];
 new_fragments text[] := array['v_readiness_persona text;', 'v_readiness_persona:=case r.persona', 't.persona=v_readiness_persona', '''persona'',v_readiness_persona,'];
begin
 original := pg_get_functiondef('private.es02_paid_branch_readiness(uuid,uuid)'::regprocedure);
 patched := original;
 for i in 1..array_length(old_fragments,1) loop
  old_frag := old_fragments[i]; new_frag := new_fragments[i];
  if (length(patched)-length(replace(patched,old_frag,''))) / length(old_frag) <> 1 then
   raise exception 'READINESS_PERSONA_PREREQUISITE_MISMATCH';
  end if;
  patched := replace(patched,old_frag,new_frag);
 end loop;
 execute patched;
end;
$migration$;
