// Owner-approved staged-tree extraction; canonical ownership is checked by the delivery controller.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyWorkspace,normalizeScope,overlaps} from '../consolidation/guard.mjs';
import {forbiddenTrackedPath} from './security-rules.mjs';

const oidPattern=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error(code);};
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
const blobOid=bytes=>createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const outputs=new Set(['node_modules','.next','tsconfig.tsbuildinfo','next-env.d.ts']);
const overlapsPath=(a,b)=>{const left=process.platform==='win32'?a.toLowerCase():a;const right=process.platform==='win32'?b.toLowerCase():b;return left===right||left.startsWith(right+sep)||right.startsWith(left+sep);};

function directoryTree(entries){
 const directories=new Map();
 for(const entry of entries){const parts=entry.path.split('/');const name=parts.pop();let node=directories;for(const part of parts){if(!node.has(part))node.set(part,new Map());node=node.get(part);}node.set(name,entry);}
 return directories;
}
function treeDigest(node){
 const sorted=[...node].sort(([a,x],[b,y])=>Buffer.compare(Buffer.from(a+(x instanceof Map?'/':'')),Buffer.from(b+(y instanceof Map?'/':''))));
 const bytes=Buffer.concat(sorted.map(([name,value])=>{const child=value instanceof Map;return Buffer.concat([Buffer.from(`${child?'40000':value.mode} ${name}\0`),Buffer.from(child?treeDigest(value):value.oid,'hex')]);}));
 return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
}

export function safeSourcePath(path){
 if(typeof path!=='string'||!path||path.includes('\\')||/[\x00-\x1f\x7f]/.test(path)||path.includes(':')||path.startsWith('/'))fail('SNAPSHOT_UNSAFE_PATH');
 const parts=path.split('/');
 if(parts.some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))fail('SNAPSHOT_UNSAFE_PATH');
 if(parts.some(part=>part.toLowerCase()==='.git')||outputs.has(parts[0].toLowerCase()))fail('SNAPSHOT_RESERVED_PATH');
 if(forbiddenTrackedPath(path.toLowerCase()))fail('SNAPSHOT_PRIVATE_PATH');
 return path;
}

export function validateEntries(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>20000)fail('SNAPSHOT_ENTRY_COUNT');
 const names=new Set();
 for(const entry of entries){
  safeSourcePath(entry.path);
  if(!['100644','100755'].includes(entry.mode)||entry.type!=='blob'||!oidPattern.test(entry.oid??''))fail('SNAPSHOT_UNSUPPORTED_ENTRY');
  const key=entry.path.toLowerCase();if(names.has(key))fail('SNAPSHOT_CASE_COLLISION');names.add(key);
 }
 for(const path of names){const parts=path.split('/');parts.pop();while(parts.length){if(names.has(parts.join('/')))fail('SNAPSHOT_PATH_COLLISION');parts.pop();}}
 return entries;
}

function git(root,args,options={}){
 const env={GIT_OPTIONAL_LOCKS:'0'};for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','HOME','USERPROFILE'])if(process.env[name])env[name]=process.env[name];
 return execFileSync('git',args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,...options});
}

export function indexManifest(root,{writeObjects=false}={}){
 // write-tree refreshes the actual index cache even with OPTIONAL_LOCKS=0.
 // Read stage0 entries and construct equivalent Git tree objects without touching index bytes.
 const raw=git(root,['ls-files','--stage','-z'],{encoding:'utf8'});
 const entries=raw.split('\0').filter(Boolean).map(line=>{
  const tab=line.indexOf('\t');if(tab<0)fail('SNAPSHOT_ENTRY_INVALID');
  const [mode,oid,stage,...extra]=line.slice(0,tab).split(' ');if(extra.length||stage!=='0')fail('SNAPSHOT_UNMERGED_INDEX');
  return {mode,type:'blob',oid,path:line.slice(tab+1)};
 });
 validateEntries(entries);
 const directories=directoryTree(entries);
 const build=node=>{
  const input=[];for(const [name,value] of node){const child=value instanceof Map;const oid=child?build(value):value.oid;input.push(`${child?'040000':value.mode} ${child?'tree':'blob'} ${oid}\t${name}\0`);}
  const oid=git(root,['mktree','-z'],{input:Buffer.from(input.join('')),encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  if(!oidPattern.test(oid))fail('SNAPSHOT_TREE_INVALID');return oid;
 };
 return {tree:writeObjects?build(directories):treeDigest(directories),entries};
}

function plainDirectory(path){
 if(!existsSync(path)||lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory()||!samePath(realpathSync(path),resolve(path)))fail('SNAPSHOT_ROOT_INVALID');
}

export function extractIndex(root,destination){
 // Destination is an explicitly allocated empty test directory, never canonical source.
 plainDirectory(destination);
 const common=realpathSync(resolve(root,git(root,['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()));
 const destinationReal=realpathSync(destination);
 if(overlapsPath(realpathSync(root),destinationReal)||overlapsPath(common,destinationReal))fail('SNAPSHOT_SOURCE_DESTINATION_OVERLAP');
 const manifest=indexManifest(root);
 if(readdirSync(destination).length)fail('SNAPSHOT_DESTINATION_NOT_EMPTY');
 if(samePath(realpathSync(root),realpathSync(destination)))fail('SNAPSHOT_SOURCE_DESTINATION_ALIAS');
 const input=manifest.entries.map(entry=>entry.oid+'\n').join('');
 const metadata=git(root,['cat-file','--batch-check'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim().split('\n');
 let total=0;const sized=manifest.entries.map((entry,index)=>{
  const [oid,type,size]=metadata[index].split(' ');const bytes=Number(size);
  if(oid!==entry.oid||type!=='blob'||!Number.isSafeInteger(bytes)||bytes<0||bytes>64*1024*1024)fail('SNAPSHOT_SIZE_LIMIT');
  total+=bytes;return {...entry,bytes};
 });
 if(total>512*1024*1024)fail('SNAPSHOT_SIZE_LIMIT');
 for(let start=0;start<sized.length;){
  let end=start,groupBytes=0;while(end<sized.length&&(end===start||groupBytes+sized[end].bytes<=32*1024*1024)){groupBytes+=sized[end++].bytes;}
  const group=sized.slice(start,end);
  const result=git(root,['cat-file','--batch'],{input:group.map(entry=>entry.oid+'\n').join(''),stdio:['pipe','pipe','pipe'],maxBuffer:128*1024*1024});
  let offset=0;
  for(const entry of group){
   const newline=result.indexOf(10,offset);if(newline<0)fail('SNAPSHOT_BLOB_MISMATCH');
   if(result.subarray(offset,newline).toString()!==entry.oid+' blob '+entry.bytes)fail('SNAPSHOT_BLOB_MISMATCH');
   const bytes=result.subarray(newline+1,newline+1+entry.bytes);offset=newline+2+entry.bytes;
   if(blobOid(bytes)!==entry.oid)fail('SNAPSHOT_BLOB_MISMATCH');
   const target=join(destination,...entry.path.split('/'));mkdirSync(dirname(target),{recursive:true});
   let ancestor=dirname(target);while(!samePath(ancestor,resolve(destination))){plainDirectory(ancestor);ancestor=dirname(ancestor);}
   if(existsSync(target))fail('SNAPSHOT_DESTINATION_COLLISION');
   writeFileSync(target,bytes,{flag:'wx',mode:entry.mode==='100755'?0o755:0o644});
  }
  if(offset!==result.length)fail('SNAPSHOT_BLOB_MISMATCH');start=end;
 }
 assertSnapshot(destination,manifest);return manifest;
}

export function assertSnapshot(root,manifest){
 plainDirectory(root);validateEntries(manifest.entries);
 if(!oidPattern.test(manifest.tree??''))fail('SNAPSHOT_TREE_INVALID');
 if(treeDigest(directoryTree(manifest.entries))!==manifest.tree)fail('SNAPSHOT_MANIFEST_TREE_MISMATCH');
 const expected=new Map(manifest.entries.map(entry=>[entry.path,entry]));
 const seen=new Set();
 const walk=(directory,prefix='')=>{
  for(const name of readdirSync(directory)){
   const path=prefix?prefix+'/'+name:name;const absolute=join(directory,name);const st=lstatSync(absolute);
   if(st.isSymbolicLink())fail('SNAPSHOT_POINTER_DETECTED');
   if(!prefix&&outputs.has(name)&&!expected.has(path))continue;
   safeSourcePath(path);
   if(st.isDirectory()){walk(absolute,path);continue;}
   if(!st.isFile()||!expected.has(path))fail('SNAPSHOT_UNEXPECTED_SOURCE');
   if(blobOid(readFileSync(absolute))!==expected.get(path).oid)fail('SNAPSHOT_SOURCE_CHANGED');seen.add(path);
  }
 };
 walk(root);if(seen.size!==expected.size)fail('SNAPSHOT_SOURCE_MISSING');
}

export function assertManifestUnchanged(root,expected){
 const current=indexManifest(root);
 if(JSON.stringify(current)!==JSON.stringify(expected))fail('SNAPSHOT_INDEX_CHANGED');
}

export function assertApprovedDelta(changed,approved){
 if(!Array.isArray(approved)||!approved.length||new Set(approved).size!==approved.length||approved.some(path=>safeSourcePath(path)!==path))fail('PRE_PUSH_APPROVED_MANIFEST_INVALID');
 if(changed.some(path=>!approved.includes(path)))fail('PRE_PUSH_UNAPPROVED_PATH');
}

function concurrentScopeCheck(approved, mutableScopes) {
 if(!Array.isArray(mutableScopes))fail('PRE_PUSH_MUTABLE_SCOPES_INVALID');
 const scopes=[...new Set(mutableScopes.map(normalizeScope))];
 if(scopes.some(scope=>approved.some(path=>overlaps(scope,normalizeScope(path)))))fail('PRE_PUSH_MUTABLE_SCOPE_OVERLAP');
 return path=>!forbiddenTrackedPath(path.toLowerCase())&&scopes.some(scope=>overlaps(scope,normalizeScope(path)));
}
export function capturePreserved(root,approved,fixedPaths=[],mutableScopes=[]){
 const mutable=concurrentScopeCheck(approved,mutableScopes);
 const excluded=new Set(fixedPaths);
 for(const args of [['diff','--name-only','-z','HEAD'],['ls-files','--others','--exclude-standard','-z']]){
  for(const file of git(root,args,{encoding:'utf8'}).split('\0').filter(Boolean))excluded.add(file);
 }
 // Do not inspect files being edited by another reserved writer. The publisher
 // extracts only index blobs into a separate snapshot and never writes their WIP.
 const cachePath='scripts/account-deletion/.vite',cache=join(root,cachePath);
 const collect=(directory,prefix)=>{for(const name of readdirSync(directory)){
  const rel=prefix+'/'+name;if(mutable(rel))continue;const absolute=join(directory,name);
  if(lstatSync(absolute).isDirectory()&&!lstatSync(absolute).isSymbolicLink())collect(absolute,rel);else excluded.add(rel);
 }};
 if(!mutable(cachePath)&&existsSync(cache)){plainDirectory(cache);collect(cache,cachePath);}
 return [...excluded].sort().filter(path=>!mutable(path)).map(path=>{
  if(forbiddenTrackedPath(path.toLowerCase()))return {path,kind:'private-not-opened'};
  const absolute=resolve(root,path);if(!absolute.startsWith(resolve(root)+sep))fail('PRE_PUSH_UNSAFE_PRESERVED_PATH');
  if(!existsSync(absolute))return {path,kind:'missing'};
  const stat=lstatSync(absolute);if(stat.isSymbolicLink()||!stat.isFile())fail('PRE_PUSH_PRESERVED_POINTER');
  if(!samePath(realpathSync(absolute),absolute))fail('PRE_PUSH_PRESERVED_POINTER');
  return {path,kind:'file',digest:createHash('sha256').update(readFileSync(absolute)).digest('hex')};
 });
}
export function assertPreserved(root,before,approved,mutableScopes=[]){
 const mutable=concurrentScopeCheck(approved,mutableScopes);
 const immutable=before.filter(entry=>!mutable(entry.path));
 if(JSON.stringify(capturePreserved(root,approved,before.map(entry=>entry.path),mutableScopes))!==JSON.stringify(immutable))fail('PRE_PUSH_PRESERVED_WORK_CHANGED');
}

export function gateInvocation(gate,context,contextFile){
 if(gate.id.startsWith('dependencies/'))return {args:gate.args,cwd:context.snapshot};
 const args=[join(context.snapshot,gate.args[0]),...gate.args.slice(1)];
 if(gate.id!=='secrets/install')args.push('--candidate-context',contextFile);
 return {args,cwd:context.canonical};
}

export function candidateContextArgument(args=process.argv){
 const at=args.indexOf('--candidate-context');if(at<0)return null;
 if(at!==args.length-2||!args[at+1])fail('SNAPSHOT_CONTEXT_ARGUMENT_INVALID');return args[at+1];
}

export function loadGateContext(file,env=process.env){
 if(!file)return null;
 const ownership=verifyWorkspace(env,{delivery:true});
 const canonical=realpathSync(process.cwd());
 const directory=join(canonical,'.git','velora-pre-push');
 const absolute=resolve(file);
 if(!absolute.startsWith(directory+sep)||!samePath(absolute,realpathSync(absolute))||lstatSync(absolute).isSymbolicLink())fail('SNAPSHOT_CONTEXT_PATH_INVALID');
 const context=JSON.parse(readFileSync(absolute,'utf8'));
 if(context.schemaVersion!==1||!samePath(context.canonical,canonical)||!samePath(dirname(context.snapshot),realpathSync(tmpdir()))||!basename(context.snapshot).startsWith('velora-candidate-'))fail('SNAPSHOT_CONTEXT_INVALID');
 for(const key of ['owner','task','publicationBase','reservationFingerprint'])if(context.ownership[key]!==ownership[key])fail('PRE_PUSH_OWNERSHIP_CHANGED');
 if(git(canonical,['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==context.head)fail('PRE_PUSH_CANDIDATE_CHANGED');
 assertManifestUnchanged(canonical,context.manifest);
 assertSnapshot(context.snapshot,context.manifest);
 return context;
}

export function snapshotCandidateIdentity(context){
 return {headSha:context.head,workingTreeState:'staged_snapshot',treeSha:context.manifest.tree,baseSha:context.base,owner:context.ownership.owner,task:context.ownership.task,reservationFingerprint:context.ownership.reservationFingerprint,capturedAt:new Date().toISOString()};
}
