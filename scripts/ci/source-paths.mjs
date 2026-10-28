import { forbiddenTrackedPath } from './security-rules.mjs';
const oidPattern=/^[a-f0-9]{40}$/;
const fail=code=>{throw Error(code);};
const outputs=new Set(['node_modules','.next','tsconfig.tsbuildinfo','next-env.d.ts']);

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
