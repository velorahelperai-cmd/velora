// Prints names/locations only. Private definitions stay outside Git/NotebookLM.
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {loadMetadata} from './schema-replay.mjs';
const metadata=loadMetadata(process.argv[2]);
const names=new Set(metadata.routines.functions.filter(f=>f.schema==='public').map(f=>f.name));
const missing=new Map();
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(p)&&!/(?:test|optin)\.[^/\\]+$/.test(p)){
 const text=readFileSync(p,'utf8');for(const match of text.matchAll(/\.rpc\s*\(\s*["']([a-z_][a-z0-9_]*)["']/g))if(!names.has(match[1])){
  const locations=missing.get(match[1])??[];locations.push(`${relative(resolve('.'),p).replaceAll('\\','/')}:${text.slice(0,match.index).split('\n').length}`);missing.set(match[1],locations);
 }
}}}
walk('src');
console.log(JSON.stringify({scope:'production src literal RPC names only; dynamic names/complete schema compatibility not proven',target:metadata.project_ref,missing_rpc_names:Object.fromEntries([...missing].sort())},null,2));
