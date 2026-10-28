import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSourcePath, validateEntries } from './source-paths.mjs';
test('private paths, traversal, Windows aliases, case collisions and git links are denied',()=>{
 for(const path of ['../outside','a/../outside','C:/outside','a\\outside','.git/config','source:stream','con.txt','a.','name ','/root','.ENV.local','credentials.json'])assert.throws(()=>safeSourcePath(path));
 const entry={mode:'100644',type:'blob',oid:'a'.repeat(40),path:'a.txt'};
 assert.throws(()=>validateEntries([entry,{...entry,path:'A.txt'}]),/SNAPSHOT_CASE_COLLISION/);
 assert.throws(()=>validateEntries([{...entry,mode:'120000'}]),/SNAPSHOT_UNSUPPORTED_ENTRY/);
 assert.throws(()=>validateEntries([{...entry,mode:'160000',type:'commit'}]),/SNAPSHOT_UNSUPPORTED_ENTRY/);
 assert.throws(()=>validateEntries([entry,{...entry,path:'a.txt/nested'}]),/SNAPSHOT_PATH_COLLISION/);
});
