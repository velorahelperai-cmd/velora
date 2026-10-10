import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assemble} from './build.mjs';
test('one bounded transaction requires containment and drained native sessions',()=>{
 const {bundle}=assemble();assert.equal(bundle.match(/^begin;$/gm).length,1);assert.equal(bundle.match(/^commit;$/gm).length,1);
 assert.match(bundle,/CONTAINMENT_REQUIRED/);assert.match(bundle,/REVIEW_WINDOW_NOT_DRAINED_OR_NOT_VISIBLE/);
 assert.doesNotMatch(bundle,/alter table public\.billing_|create table.*ledger|set .*check_function_bodies\s*=\s*false/i);
});
test('usage_role contract matches only the approved source prerequisite, no bulk preparation',()=>{
 const approved=readFileSync('supabase/migrations/20261008144500_vel_company_answer_profile.sql','utf8').replaceAll('\r\n','\n');
 const prereq=readFileSync('supabase/upgrade-packages/g03-cloud-compatibility/20261010003237_g03_cloud_knowledge_prerequisites.sql','utf8').replaceAll('\r\n','\n');
 const statements=s=>s.replace(/^--.*$/gm,'').replace(/\s+/g,' ').trim();
 assert.equal(statements(prereq),statements(approved.slice(approved.indexOf('alter table'),approved.indexOf('create index'))));
 assert.doesNotMatch(prereq,/\bupdate public\.knowledge_sources\b/i);
});
test('containment retains API shape and refuses all writes without touching history',()=>{
 const {containment}=assemble();assert.match(containment,/UPGRADE_PENDING/);assert.doesNotMatch(containment,/\b(insert|update|delete|truncate)\b/i);
 assert.match(containment,/revoke all on function public\.transition_company_review/);
});
test('committed review artifacts reproduce byte-for-byte',()=>{
 const built=assemble();assert.equal(readFileSync('supabase/upgrade-packages/g03-cloud-compatibility/10-upgrade.review.sql','utf8').replaceAll('\r\n','\n'),built.bundle);
 assert.equal(readFileSync('supabase/upgrade-packages/g03-cloud-compatibility/00-containment.review.sql','utf8').replaceAll('\r\n','\n'),built.containment);
});
