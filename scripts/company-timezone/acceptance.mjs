// Opt-in synthetic acceptance on an already verified, explicitly selected recovery isolate.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';import {isAbsolute,relative,resolve} from 'node:path';
const receiptPath=process.env.VELORA_TIMEZONE_RESTORE_RECEIPT;if(!receiptPath||!isAbsolute(receiptPath)||!relative(resolve('.'),receiptPath).startsWith('..'))throw Error('EXPLICIT_EXTERNAL_RESTORE_RECEIPT_REQUIRED');
const r=JSON.parse(readFileSync(receiptPath,'utf8').replace(/^\uFEFF/,''));if(r.status!=='SCOPED_RESTORE_VERIFIED')throw Error('RESTORE_GATE_REQUIRED');
function run(args,input=''){const v=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,windowsHide:true});if(v.status!==0)throw Error(/ERROR:\s+([A-Z_0-9]+)/.exec(v.stderr??'')?.[1]??'PRIVATE_LOCAL_SQL_FAILURE');return v.stdout.trim();}
function verify(){const c=JSON.parse(run(['inspect',r.container]))[0];if(c.Config.Labels['velora.task']!=='release-scoped-restore'||c.Config.Labels['velora.run']!==r.run||c.Config.Image!=='supabase/postgres:17.6.1.136'||c.HostConfig.NetworkMode!=='none'||c.HostConfig.LogConfig.Type!=='none'||!c.HostConfig.Tmpfs['/var/lib/postgresql/data']||c.Mounts.some(m=>m.Type!=='tmpfs')||Object.keys(c.HostConfig.PortBindings??{}).length)throw Error('UNSAFE_LOCAL_TARGET');}
function sql(s){verify();return run(['exec','-i','-u','postgres',r.container,'psql','-X','-Atq','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',r.database],"SET statement_timeout='30s';"+s);}
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const oldColumns=JSON.parse(sql("SELECT json_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid='public.companies'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'timezone';"));
const digest=()=>sql("SELECT count(*)::text||'|'||md5(coalesce(string_agg(jsonb_build_object("+oldColumns.flatMap(c=>[literal(c),'c."'+c+'"']).join(',')+")::text,',' ORDER BY c.id),'')) FROM public.companies c;");
const before=digest();
if(process.env.VELORA_TIMEZONE_APPLY==='1')sql('SET ROLE postgres;'+readFileSync('supabase/upgrade-packages/company-timezone/10-timezone.review.sql','utf8'));
assert.equal(sql("SELECT count(*) FROM pg_attribute WHERE attrelid='public.companies'::regclass AND attname='timezone' AND attnum>0 AND NOT attisdropped;"),'1','timezone column must exist after the compatibility prerequisite');
assert.equal(digest(),before,'every original company field and row must survive');
assert.equal(sql('SELECT count(*) FROM public.companies WHERE timezone IS NOT NULL;'),'0','existing companies retain explicit unknown/null semantics');
const company=randomUUID(),user=randomUUID();sql('BEGIN;INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('+literal(user)+",'synthetic-timezone@local.invalid',clock_timestamp());INSERT INTO public.companies(id,display_name,status,created_by) VALUES("+literal(company)+",'Synthetic timezone preservation','active',"+literal(user)+');COMMIT;');
assert.equal(sql('SELECT timezone IS NULL FROM public.companies WHERE id='+literal(company)),'t','new companies have no inferred timezone');
const reject=sql('DO $$ BEGIN BEGIN UPDATE public.companies SET timezone=\' Asia/Muscat\' WHERE id='+literal(company)+";RAISE EXCEPTION 'BAD_TIMEZONE_ACCEPTED';EXCEPTION WHEN check_violation THEN NULL;END;END;$$;SELECT 'rejected';");assert.equal(reject,'rejected');
sql("UPDATE public.companies SET timezone='Asia/Muscat' WHERE id="+literal(company));assert.equal(sql('SELECT timezone FROM public.companies WHERE id='+literal(company)),'Asia/Muscat');
assert.throws(()=>sql('SET ROLE postgres;'+readFileSync('supabase/upgrade-packages/company-timezone/10-timezone.review.sql','utf8')),/TIMEZONE_ALREADY_OR_PARTIALLY_INSTALLED/);
assert.equal(sql('SELECT timezone FROM public.companies WHERE id='+literal(company)),'Asia/Muscat','reapply refusal must preserve a deliberately saved zone');
const result={status:'TIMEZONE_ACCEPTANCE_PASS',checks:6,synthetic:true,container:r.container,production_mutation:false,original_data_digest_preserved:true,existing_and_new_company_timezone:'null until deliberate configuration',reapply_refused:true};
if(process.env.VELORA_TIMEZONE_REPORT)writeFileSync(process.env.VELORA_TIMEZONE_REPORT,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
