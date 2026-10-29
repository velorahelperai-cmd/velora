import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {isolatedEnvironment} from '../../../scripts/ci/safety.mjs';
import {createStructuredLogger,logEvent,withLogContext} from './logger.mjs';
function sink(){const lines=[];return {lines,logger:createStructuredLogger({write:line=>lines.push(JSON.parse(line))})};}
test('message strings and interpolated credentials are redacted after formatting',()=>{
 const {lines,logger}=sink(),secret=randomUUID();
 logger.warn(`password=${secret}`);
 logger.warn('password=%s',secret);
 logger.warn({event:'test.failure'},'Bearer %s',secret);
 logger.warn({event:'test.failure'},'details=%j',{token:secret});
 assert.equal(JSON.stringify(lines).includes(secret),false);
 assert.equal(lines.length,4);
 assert.equal(lines[2].event,'test.failure');
});
test('provider key formats are redacted even without a labelled field',()=>{
 const {lines,logger}=sink();
 const keys=['sk-'+'x'.repeat(40),'AIza'+'x'.repeat(35),'sb_secret_'+'x'.repeat(32)];
 for(const key of keys)logEvent('error','test.provider',{error:new Error(`Provider rejected ${key}`)},logger);
 for(const key of keys)assert.equal(JSON.stringify(lines).includes(key),false);
});
test('development and production finish an awaited flush before process exit',()=>{
 const cwd=resolve(import.meta.dirname,'../../..');
 for(const NODE_ENV of ['development','production']){
 const env={...isolatedEnvironment(),NODE_ENV,NODE_OPTIONS:'--require=./scripts/ci/offline-network-guard.cjs'};
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import {logEvent,flushLogs} from './src/lib/logging/logger.mjs';logEvent('info','test.flush.probe');await flushLogs();"],{cwd,env,encoding:'utf8',timeout:15000,windowsHide:true});
 assert.equal(child.status,0);assert.equal(child.stderr.includes('unsettled top-level await'),false);assert.ok(child.stdout.includes('test.flush.probe'));
 }
});
test('unquoted OAuth secrets in exception messages and stacks are redacted',()=>{
 const {lines,logger}=sink(),refresh=randomUUID(),client=randomUUID();
 logEvent('error','test.failure',{error:new Error(`refresh_token=${refresh} client_secret=${client}`)},logger);
 assert.equal(JSON.stringify(lines).includes(refresh),false);
 assert.equal(JSON.stringify(lines).includes(client),false);
 assert.ok(lines[0].error.stack);
});
test('nested secrets, formatted contacts and spoofed context are protected',()=>{
 const {lines,logger}=sink(),secret=randomUUID();
 withLogContext({request_id:'trusted-request',user_id:'trusted-user'},()=>logEvent('error','test.failure',{request_id:'spoofed',user_id:'raw@example.invalid',payload:{auth:{password:secret}},req:{headers:{Authorization:secret}},res:{headers:{'set-cookie':secret}},customer:{email:'contact@example.invalid',phone:'+968 1234 5678'},error:new Error(JSON.stringify({refresh_token:secret,client_secret:secret}))},logger));
 assert.equal(JSON.stringify(lines).includes(secret),false);assert.equal(lines[0].request_id,'trusted-request');assert.equal(lines[0].user_id,'trusted-user');assert.equal(lines[0].customer.email,'c***@example.invalid');assert.equal(lines[0].customer.phone,'+*** **** **78');
});
test('Meta, WhatsApp, Instagram and B3 channel secrets are redacted while preserving correlation, stage, duration and error_code',()=>{
 const {lines,logger}=sink();
 const metaGraphToken='EAABsbCS1iHgBO7syntheticTokenValue998877665544332211';
 const igToken='IGQWRPaSyntheticInstagramTokenValue112233445566778899';
 const hmacSig='sha256=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
 const verifyToken='velora-verify-'+randomUUID();
 const pinValue='654321';
 const nonceValue=randomUUID().replace(/-/g,'');
 const stageReceipt='receipt-'+randomUUID();
 withLogContext({request_id:'corr-meta-001',user_id:'actor-1',tenant_id:'company-1'},()=>{
  logEvent('warn','es02.branch_connection.failed',{
   stage:'b3.exchange',
   error_code:'reconciliation_required',
   duration_ms:142,
   pin:pinValue,
   nonce:nonceValue,
   verify_token:verifyToken,
   stage_receipt:stageReceipt,
   headers:{'x-hub-signature-256':hmacSig},
   error:new Error(`Meta exchange failed token=${metaGraphToken} ig=${igToken} sig=${hmacSig} hub.verify_token=${verifyToken} pin=${pinValue}`),
  },logger);
 });
 const serialized=JSON.stringify(lines);
 assert.equal(serialized.includes(metaGraphToken),false);
 assert.equal(serialized.includes(igToken),false);
 assert.equal(serialized.includes('abcdef0123456789'),false);
 assert.equal(serialized.includes(verifyToken),false);
 assert.equal(serialized.includes(pinValue),false);
 assert.equal(serialized.includes(nonceValue),false);
 assert.equal(serialized.includes(stageReceipt),false);
 assert.equal(lines[0].request_id,'corr-meta-001');
 assert.equal(lines[0].stage,'b3.exchange');
 assert.equal(lines[0].error_code,'reconciliation_required');
 assert.equal(lines[0].duration_ms,142);
});
test('production LOG_LEVEL cannot enable debug',()=>{
 const previous={NODE_ENV:process.env.NODE_ENV,LOG_LEVEL:process.env.LOG_LEVEL};
 try{process.env.NODE_ENV='production';process.env.LOG_LEVEL='debug';const {lines,logger}=sink();logEvent('debug','test.diagnostic',{},logger);logEvent('info','test.progress',{},logger);assert.equal(lines.length,1);assert.equal(lines[0].level,'info');}
 finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
test('JSON schema and async context are isolated without exposing credentials',async()=>{
 const {lines,logger}=sink();
 const fixturePassword=randomUUID(),fixtureToken=randomUUID();
 const connection=new URL('postgres://db.invalid');connection.username='synthetic-user';connection.password=fixturePassword;
 await Promise.all(['request-a','request-b'].map(request_id=>withLogContext({request_id,user_id:'synthetic-user'},async()=>{
  await Promise.resolve();logEvent('error','auth.logout.failed',{kind:'security',password:fixturePassword,headers:{authorization:'Bearer '+fixtureToken},error:new Error(connection.toString())},logger);
 })));
 assert.deepEqual(new Set(lines.map(line=>line.request_id)),new Set(['request-a','request-b']));
 for(const line of lines){assert.equal(line.level,'error');assert.match(line.timestamp,/^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/);for(const key of ['service','env','version','trace_id','span_id','user_id','tenant_id','event'])assert.ok(key in line);assert.ok(line.error.type);assert.ok(line.error.stack);assert.equal(JSON.stringify(line).includes(fixturePassword),false);assert.equal(JSON.stringify(line).includes(fixtureToken),false);}
});
test('LOG_LEVEL changes apply dynamically and input newlines remain JSON data',()=>{
 const previous=process.env.LOG_LEVEL,{lines,logger}=sink();
 try{process.env.LOG_LEVEL='warn';logEvent('info','test.progress',{stage:'user\ninput'},logger);assert.equal(lines.length,0);process.env.LOG_LEVEL='info';logEvent('info','test.progress',{stage:'user\ninput'},logger);assert.equal(lines.length,1);assert.equal(lines[0].stage,'user\ninput');}
 finally{if(previous===undefined)delete process.env.LOG_LEVEL;else process.env.LOG_LEVEL=previous;}
});
test('quoted secrets in error stacks and necessary contact references are masked',()=>{
 const {lines,logger}=sink();
 const fixturePassword=randomUUID()+' with spaces';
 logEvent('error','test.failure',{email:'synthetic@example.invalid',phone:'+96812345678',error:new Error(JSON.stringify({password:fixturePassword}))},logger);
 assert.equal(JSON.stringify(lines).includes(fixturePassword),false);
 assert.equal(lines[0].email,'s***@example.invalid');
 assert.equal(lines[0].phone.includes('12345678'),false);
});
test('CLI validation is WARN and unrecoverable exceptions log once with a stack',()=>{
 const cwd=resolve(import.meta.dirname,'../../..');
 const env={...isolatedEnvironment(),NODE_ENV:'production',NODE_OPTIONS:'--require=./scripts/ci/offline-network-guard.cjs'};
 const rejected=spawnSync(process.execPath,['scripts/integration/registration-local-journey.mjs','--unknown'],{cwd,env,encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(rejected.status,1);const validation=JSON.parse(rejected.stdout.trim());
 assert.equal(validation.level,'warn');assert.equal(validation.event,'test.arguments.rejected');
 const fatal=spawnSync(process.execPath,['--input-type=module','-e',"import {installProcessLogging} from './src/lib/logging/logger.mjs'; installProcessLogging(); throw Error('Synthetic startup failure');"],{cwd,env,encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(fatal.status,1);const failure=JSON.parse(fatal.stdout.trim());
 assert.equal(failure.level,'fatal');assert.equal(failure.event,'process.exception');assert.ok(failure.error.stack);
});
