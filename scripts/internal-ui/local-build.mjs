// Compile the actual product in an owned scratch directory without environment
// files, credentials or external networking. No fixtures replace product code.
import {cp,mkdir,symlink,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {guardedEnvironment,assertNoEnvironmentFiles} from '../integration/local-http-safety.mjs';
const root=resolve(import.meta.dirname,'../..'),scratch=join(tmpdir(),'codex-velora-design-build-'+randomUUID());
await mkdir(scratch,{recursive:true});
for(const name of ['src','public','package.json','package-lock.json','tsconfig.json','next.config.ts','postcss.config.mjs','.gitignore'])
 await cp(join(root,name),join(scratch,name),{recursive:true});
await mkdir(join(scratch,'scripts/integration'),{recursive:true});
await cp(join(root,'scripts/integration/local-http-network-guard.cjs'),join(scratch,'scripts/integration/local-http-network-guard.cjs'));
await symlink(join(root,'node_modules'),join(scratch,'node_modules'),'junction');
await assertNoEnvironmentFiles(scratch);
const env=guardedEnvironment(scratch,{WHATSAPP_ALLOW_EXTERNAL_SEND:'false',WHATSAPP_WORKER_ENABLED:'false',WHATSAPP_EMBEDDED_SIGNUP:'false',INSTAGRAM_SEND_ENABLED:'false',BILLING_PAYMOB_CREATE_ENABLED:'false',BILLING_PAYMOB_WEBHOOK_ENABLED:'false',BILLING_PAYMOB_SETTLE_ENABLED:'false',BILLING_PAYMOB_LIVE_ENABLED:'false',PAYMOB_LIVE_ENABLED:'false',SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED:'false',SUBSCRIPTION_EXPIRY_EMAIL_ENABLED:'false'});
const child=spawn(process.execPath,[join(root,'node_modules/next/dist/bin/next'),'build','--webpack'],{cwd:scratch,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{log+=String(chunk);process.stdout.write(chunk);});
const code=await new Promise((ok,fail)=>{child.once('error',fail);child.once('exit',ok);});
await mkdir(join(root,'artifacts/design-review'),{recursive:true});
await writeFile(join(root,'artifacts/design-review/build.log'),log+'\nISOLATED_BUILD_EXIT '+code+'\n');
console.log('ISOLATED_BUILD_EXIT',code);if(code!==0)process.exitCode=1;
