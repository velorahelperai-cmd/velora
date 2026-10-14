// Offline candidate fingerprints only. Never connects to or executes Production SQL.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const candidates=['20261014080108_smart_setup_foundation.sql','20261014080155_smart_profile_and_branch_attempts_v2.sql','20261014080217_smart_review_native_scope.sql'];
const manifest={
 productionProject:'vmpifljyozsbtssxhoxd',approvalRequired:true,verifiedRestorableBackupRequired:true,
 canonicalization:'Remove UTF-8 BOM; CRLF to LF; preserve all other bytes',
 migrations:candidates.map(name=>({name,sha256:createHash('sha256').update(readFileSync('supabase/migrations/'+name,'utf8').replace(/^\uFEFF/,'').replaceAll('\r\n','\n')).digest('hex')})),
 absentBeforeApply:['public.company_branches','private.smart_branch_setup','private.smart_branch_audit','private.smart_profile_revisions','private.smart_save_attempts','private.smart_review_policy'],
 absentFunctionsBeforeApply:['private.g03_readiness_before_smart(uuid)','private.g03_manifest_before_smart(uuid,uuid)','private.smart_setup_actor()','public.read_smart_profile(uuid)','public.read_smart_branch_setup(uuid)'],
 nativePrerequisites:['public.upsert_owner_company(text,text,text,text,text,text,text,text,text)','private.valid_company_setup_payload(jsonb)','public.check_app_session(boolean)','public.app_session_is_valid()','public.is_platform_admin()','private.company_channel_contract(uuid)'],
 conditionalMasterPrerequisites:['public.create_owner_company_attempt(uuid,uuid,jsonb)','private.master_account_can_create_company(uuid)'],
 capturedProductionDigests:{
 'private.g03_lock_actor(uuid,text,uuid)':'6a7e552989ce5f3e980d11ca320c4683',
 'public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)':'5e0dccd905f383e1b4ba541cff94b0bf',
 'public.g03_begin_review_check(text,uuid,integer,text,text,boolean,text)':'81d979a39f36076c02881f0b08dbd9a1',
 'public.g03_complete_review_check(uuid,jsonb)':'2bc5a8d474067256a0c34a67badb70f1',
 'public.transition_company_review(text,uuid,integer,text,text,boolean,text)':'ad50a7b0b5ed61c2424363e436dda2c4',
 'private.g03_readiness(uuid)':'297715b42ee88a1ee2047627380614c1',
 'private.g03_manifest(uuid,uuid)':'f5b36d15f6f4b1d1d2fb553c3de7ec5a',
 'private.g03_proof_current(uuid)':'4bdf66b8ba9caa7394e586e0b4c043fc',
 'private.company_channel_contract(uuid)':'b9f8bfb9bc58a5efdde066b1cd4ded6d',
 'private.billing_lifecycle_receipt(uuid)':'a4187eb255f7d55f0889bdb36e2c97f5',
 'private.valid_company_setup_payload(jsonb)':'4f55a0b046768d26183004b4b4eba60e',
 'public.check_app_session(boolean)':'f69c473d94466a93d1d793bbd447478e',
 'public.app_session_is_valid()':'b42c28f54d05778fcc994156c6ce4086',
 },
 requiresFreshAuthorizedFingerprintCapture:['public.upsert_owner_company(text,text,text,text,text,text,text,text,text)','public.is_platform_admin()'],
 releaseGates:['Explicit approval of this exact bundle and rollout settings','Fresh authorized catalogue preflight matches captured native function digests and preserves OIDs/ACLs','Existing company names pass primary branch constraints; backfill counts match without changing company/member/grant rows','Country changes still require review; no fabricated channel or commercial approvals','Verified restorable backup covers database, native Auth and knowledge storage','Review policy defaults false; no Master, staff/presence, payment, channel or AI activation'],
};
console.log(JSON.stringify(manifest,null,2));
