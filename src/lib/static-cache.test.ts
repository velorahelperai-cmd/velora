import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';
import config from '../../next.config';

it('retires the legacy worker without intercepting or precaching any request',async()=>{
 const events=new Map<string,(e:{waitUntil:(p:Promise<unknown>)=>void})=>void>();
 const order:string[]=[];
 const remove=vi.fn(async(name:string)=>{order.push(name);});
 const skipWaiting=vi.fn(async()=>{});
 runInNewContext(readFileSync('public/sw.js','utf8'),{
  caches:{delete:remove},self:{addEventListener:(n:string,fn:typeof events extends Map<string,infer T>?T:never)=>events.set(n,fn),skipWaiting,
   clients:{claim:async()=>{order.push('claim');}},registration:{unregister:async()=>{order.push('unregister');}}},
 });
 expect([...events.keys()]).toEqual(['install','activate']);
 const pending:Promise<unknown>[]=[];
 events.get('install')!({waitUntil:p=>pending.push(p)});events.get('activate')!({waitUntil:p=>pending.push(p)});
 await Promise.all(pending);
 expect(skipWaiting).toHaveBeenCalledOnce();expect(order).toEqual(['velora-static-v1','claim','unregister']);
});
it('limits public caching to assets/fonts and keeps worker updates revalidated',async()=>{
 const rules=await config.headers!();
 expect(rules.map(r=>r.source)).toEqual(['/assets/:path*','/fonts/:path*','/sw.js']);
 for(const rule of rules.slice(0,2)){
  const value=rule.headers.find(h=>h.key==='Cache-Control')!.value;
  expect(value).toContain('max-age=3600');expect(value).not.toContain('immutable');
 }
 expect(rules[2].headers).toContainEqual({key:'Cache-Control',value:'public, max-age=0, must-revalidate'});
});
