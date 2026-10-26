import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdirSync,rmdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
const scratch=mkdtempSync(join(tmpdir(),'velora-lifecycle-test-'));
mkdirSync(join(scratch,'.git'));
const guardSource=readFileSync(new URL('./guard.mjs',import.meta.url),'utf8').replace(/export const ROOT = .*?;/,'export const ROOT = '+JSON.stringify(scratch)+';').replace("const publicationBase = git('rev-parse', 'HEAD');", "const publicationBase = '"+'a'.repeat(40)+"';");
writeFileSync(join(scratch,'guard.mjs'),guardSource);
const moduleUrl=pathToFileURL(join(scratch,'guard.mjs')).href;
const {reservePaths,claimDelivery,endDelivery,releasePaths,reservationStatus}=await import(moduleUrl);
const file=new URL('./.git/velora-path-reservations.json',moduleUrl);
const empty=()=>({schemaVersion:2,reservations:[],deliveryOwner:null,deliveryTask:null});
const reset=()=>writeFileSync(file,JSON.stringify(empty()));
const env={VELORA_WRITER_ID:'A',VELORA_TASK_ID:'TASK'};
const reserve=(owner='A',task='TASK',paths=['src/a.ts'])=>reservePaths({owner,task,paths});
test('fresh post-release receipt cannot report the old lease; open task grants no writer ownership',()=>{
 reset();reserve();const before=reservationStatus(env);releasePaths({owner:'A',task:'TASK'});const after=reservationStatus(env);
 assert.equal(before.ownReservationCount,1);assert.equal(after.ownReservationCount,0);assert.equal(after.observerTask,'TASK');
 assert.equal(after.reservations.length,0);assert.notEqual(after.registrySha256,before.registrySha256);
 assert.equal(after.registrySha256,createHash('sha256').update(readFileSync(file)).digest('hex'));
 assert.match(after.observedAt,/Z$/);assert.equal(after.registryPath.replaceAll('\\','/'),fileURLToPath(file).replaceAll('\\','/'));
});
test('own delivery resumes idempotently while foreign owner or different task cannot claim',()=>{
 reset();reserve();assert.equal(claimDelivery('A','TASK').alreadyOwned,false);
 assert.equal(claimDelivery('A','TASK').alreadyOwned,true);assert.equal(reservationStatus(env).deliveryState,'owned');
 assert.equal(reservationStatus({...env,VELORA_WRITER_ID:'B'}).deliveryState,'foreign');
 assert.equal(reservationStatus({...env,VELORA_TASK_ID:'OTHER'}).deliveryState,'same-owner-other-task');
 assert.throws(()=>claimDelivery('B','TASK'),/DELIVERY_ALREADY_CLAIMED/);
 assert.throws(()=>claimDelivery('A','OTHER'),/DELIVERY_ALREADY_CLAIMED/);
 assert.throws(()=>releasePaths({owner:'A',task:'TASK'}),/DELIVERY_IN_PROGRESS/);
 assert.throws(()=>endDelivery('B'),/DELIVERY_OWNERSHIP_MISMATCH/);
});
test('owned resume preserves protected scopes and baseline; acquisition cannot expand an active claim',()=>{
 for(const drift of [r=>r.reservations[0].paths.push('src/extra.ts'),r=>r.reservations[0].publicationBase='c'.repeat(40),r=>delete r.deliveryReservationFingerprint]){
  reset();reserve();claimDelivery('A','TASK');const before=readFileSync(file);
  assert.throws(()=>reserve('A','TASK',['src/extra.ts']),/DELIVERY_SCOPE_FROZEN/);assert.deepEqual(readFileSync(file),before);
  const r=JSON.parse(before);drift(r);writeFileSync(file,JSON.stringify(r));
  assert.throws(()=>claimDelivery('A','TASK'),/DELIVERY_RESUME_IDENTITY_CHANGED/);
 }
});
test('competing paths conflict while independent writer leases survive delivery',()=>{
 reset();reserve();reserve('B','OTHER',['src/b.ts']);assert.throws(()=>reserve('B','OVERLAP',['src/a.ts']),/PATH_ALREADY_RESERVED/);
 claimDelivery('A','TASK');reserve('B','OTHER',['src/c.ts']);
 assert.throws(()=>releasePaths({owner:'B',task:'TASK'}),/RESERVATION_NOT_FOUND/);
 assert.throws(()=>reserve('B','CONFLICT',['src/a.ts']),/DELIVERY_PATH_CONFLICT/);
 reserve('A','INDEPENDENT',['src/d.ts']);releasePaths({owner:'A',task:'INDEPENDENT'});
 releasePaths({owner:'B',task:'OTHER'});assert.equal(claimDelivery('A','TASK').alreadyOwned,true);
 assert.ok(reservationStatus(env).deliveryMutableScopes.includes('src/c.ts'));
});

test('interrupted mutex fails closed and requires verified recovery, never timeout stealing',()=>{
 reset();reserve();const mutex=new URL('./.git/velora-path-reservations.mutex',moduleUrl);mkdirSync(mutex);
 const saved=readFileSync(file);try{assert.throws(()=>claimDelivery('A','TASK'),/REGISTRY_BUSY/);assert.deepEqual(readFileSync(file),saved);}finally{rmdirSync(mutex);}
 // Fixture cleanup above is not an operator recovery mechanism.
 claimDelivery('A','TASK');endDelivery('A');releasePaths({owner:'A',task:'TASK'});assert.equal(reservationStatus(env).reservations.length,0);
});
test('delivery acquisition serializes with disjoint reservation races without global pause',async()=>{
 const child=code=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});let text='';p.stdout.on('data',d=>text+=d);p.stderr.on('data',d=>text+=d);p.on('exit',code=>resolve({code,text}));});
 for(let i=0;i<8;i++){reset();reserve();const results=await Promise.all([
 child('import {claimDelivery} from '+JSON.stringify(moduleUrl)+';try{claimDelivery("A","TASK");console.log("OK")}catch(e){console.log(e.message)}'),
 child('import {reservePaths} from '+JSON.stringify(moduleUrl)+';try{reservePaths({owner:"B",task:"OTHER",paths:["src/b.ts"]});console.log("OK")}catch(e){console.log(e.message)}')]);
 assert.ok(results.every(x=>x.code===0));const r=reservationStatus(env);if(r.deliveryOwner==='A'&&r.reservations.some(x=>x.owner==='B'))assert.ok(r.deliveryMutableScopes.includes('src/b.ts'));
 assert.ok(results.some(x=>x.text.trim()==='OK'));assert.ok(results.every(x=>x.text.trim()==='OK'||x.text.trim()==='REGISTRY_BUSY'));
 if(r.deliveryOwner==='A')assert.throws(()=>claimDelivery('C','SECOND'),/DELIVERY_ALREADY_CLAIMED/);
 }
});

test('disjoint writers continue through a frozen delivery and cannot become second publisher',()=>{
 reset();reserve();reserve('B','OTHER',['src/b.ts']);claimDelivery('A','TASK');
 const fingerprint=reservationStatus(env).deliveryReservationFingerprint;
 reserve('B','OTHER',['src/c.ts']);reserve('C','NEW',['src/d.ts']);
 releasePaths({owner:'B',task:'OTHER'});
 assert.equal(claimDelivery('A','TASK').alreadyOwned,true);
 assert.equal(reservationStatus(env).deliveryReservationFingerprint,fingerprint);
 assert.ok(reservationStatus(env).deliveryMutableScopes.includes('src/c.ts'));
 assert.throws(()=>reserve('B','CONFLICT',['src/a.ts']),/DELIVERY_PATH_CONFLICT|PATH_ALREADY_RESERVED/);
 assert.throws(()=>claimDelivery('C','NEW'),/DELIVERY_ALREADY_CLAIMED/);
 endDelivery('A');releasePaths({owner:'A',task:'TASK'});
 assert.equal(reservationStatus(env).reservations[0].owner,'C');
});
