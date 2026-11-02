import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {measureRead,traceRead} from './read-performance';

it('isolates concurrent journeys and reports no values or exception details',async()=>{
 const logs:Record<string,unknown>[]=[];
 const log=vi.spyOn(console,'info').mockImplementation(value=>logs.push(JSON.parse(value)));
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 try{
  const first=traceRead('service_inbox',()=>measureRead('broker',async()=>{await pending;return 'private-value';}));
  await traceRead('workspace',()=>measureRead('client',async()=>42));
  release();expect(await first).toBe('private-value');
  expect(logs[0].operation).toBe('workspace');expect(logs[1].operation).toBe('service_inbox');
  expect(logs[0].stages).toEqual({client:{count:1,total_ms:expect.any(Number)}});
  expect(logs[1].stages).toEqual({broker:{count:1,total_ms:expect.any(Number)}});
  expect(JSON.stringify(logs)).not.toContain('private-value');
  await expect(traceRead('workspace',()=>measureRead('client',async()=>{throw new Error('private-error');}))).rejects.toThrow('private-error');
  expect(logs[2].outcome).toBe('threw');expect(JSON.stringify(logs)).not.toContain('private-error');
 }finally{release();log.mockRestore();}
});
