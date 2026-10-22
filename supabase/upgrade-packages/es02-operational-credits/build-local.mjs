import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const folder = dirname(fileURLToPath(import.meta.url));
const root = resolve(folder, "../../..");
const parts = ["wallet-core.sql", "acceptance-clock.sql", "authority.sql", "worker-cost.sql", "usage-reconciliation.sql", "worker-bridge.sql"];
const sources = parts.map(name => ({ name, text: readFileSync(resolve(folder, name), "utf8") }));
const baseline = JSON.parse(readFileSync(resolve(folder, "local-baseline.json"), "utf8"));
const pins = [
  ["20261020150000_es02_single_branch_scope.sql", "f28add59fc3df67f551571a4c15bf28d7f6010b7b8cc5a50a4a6549ade45527f"],
  ["20261020153000_es02_b4_branch_hours.sql", "0d9d580d6eb2069dbf93cebf01fce1caa8bbb6f38c726ed372fcbd7b6454e75b"],
  ["20261020180000_es02_b5_b8_branch_setup_completion.sql", "223901ae00e3c130c4370ebf2c655ba6a9e3eddc1a9d88959a74db9a89c615c9"],
];
const branchSources = pins.map(([name, hash]) => {
  const raw = readFileSync(resolve(root, "supabase/migrations", name));
  if (createHash("sha256").update(raw).digest("hex") !== hash) throw Error(`REVIEWED_SOURCE_CHANGED:${name}`);
  let text = raw.toString("utf8").replaceAll("\r\n", "\n");
  if (name.includes("b5_b8")) {
    // This NEW approved local contract replaces the old master-credit adapter.
    // The historical migration remains intact. Its branch implementation is
    // composed with the ES02 atomic hold/settle/clock/worker authority below;
    // removing the old adapter alone is never an installable package.
    const from = text.indexOf("  -- Preserve the reviewed operational credit dependency");
    const to = text.indexOf("  if to_regprocedure('private.es02_require_active_actor(uuid)')");
    const priority = text.indexOf("-- Change only the grant ordering in the existing operational ledger.");
    if (from < 0 || to < from || priority < to || !text.slice(priority).includes("$priority$;")) throw Error("UNREVIEWED_LEGACY_ADAPTER_LAYOUT");
    text = text.slice(0, from) + text.slice(to, priority) + "\ncommit;\n";
  }
  if (!/^begin;$/m.test(text) || !/^commit;$/m.test(text)) throw Error("SOURCE_TRANSACTION_LAYOUT_CHANGED");
  return { name, text: text.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "") };
});
const historyName = "20261022093000_es02_trial_session_history.sql";
const historyRaw = readFileSync(resolve(root, "supabase/migrations", historyName));
if (createHash("sha256").update(historyRaw).digest("hex") !== "d023c0adbd0efb3df2f99d7e56fde89f2ac15647a92f160532cfa35ff6538e2c") throw Error("REVIEWED_TRIAL_HISTORY_SOURCE_CHANGED");
const history = historyRaw.toString("utf8").replaceAll("\r\n", "\n");
const ddlAt = history.indexOf("alter table private.es02_branch_trial_operations add column");
const fnAt = history.indexOf("create or replace function public.es02_reserve_branch_trial(");
if (ddlAt < 0 || fnAt < ddlAt || !/^commit;$/m.test(history)) throw Error("TRIAL_HISTORY_LAYOUT_CHANGED");
const historySource = {
  name: `${historyName} (idempotent local overlay)`,
  text: `do $history_overlay$ begin
 if not exists(select 1 from information_schema.columns where table_schema='private' and table_name='es02_branch_trial_operations' and column_name='native_session_id_snapshot') then
 ${history.slice(ddlAt, fnAt)}
 end if;
end;$history_overlay$;\n${history.slice(fnAt).replace(/^commit;\s*$/m, "")}`,
};
const header = `-- GENERATED LOCAL-ONLY CANDIDATE. Production installation is NOT approved.
-- Generated from the adjacent reviewed fragments; do not hand-edit this file.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $local_only$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then
  raise exception 'LOCAL_ONLY_ES02_CANDIDATE_PRODUCTION_REVIEW_REQUIRED';
 end if;
 if to_regclass('private.es02_reply_credit_holds') is not null then
  raise exception 'ES02_CANDIDATE_ALREADY_PRESENT_INSPECT_INSTEAD_OF_REAPPLY';
 end if;
end;$local_only$;
do $baseline_guard$ declare dep jsonb; begin
 for dep in select value from jsonb_array_elements($baseline$${JSON.stringify(baseline.functions)}$baseline$::jsonb) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(dep->>'signature')
   and md5(replace(p.prosrc,chr(13),''))=dep->>'hash'
   and pg_get_userbyid(p.proowner)=dep->>'owner' and p.prosecdef=(dep->>'definer')::boolean
   and coalesce(to_jsonb(p.proconfig),'null'::jsonb)=dep->'config'
   and p.proacl::text is not distinct from dep->>'acl') then
   raise exception 'ES02_LOCAL_BASELINE_CHANGED:%',dep->>'signature';
  end if;
 end loop;
end;$baseline_guard$;
`;
const text = header + [...branchSources, historySource, ...sources].map(s => `\n-- SOURCE ${s.name} sha256=${createHash("sha256").update(s.text).digest("hex")}\n${s.text}`).join("\n") + "\nnotify pgrst,'reload schema';\ncommit;\n";
const output = resolve(root, "supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql");
writeFileSync(output, text);
console.log(JSON.stringify({ stage: "es02_local_candidate_build", fragments: parts.length, sha256: createHash("sha256").update(text).digest("hex"), productionApproved: false }));
